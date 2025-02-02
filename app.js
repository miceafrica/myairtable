const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');

// Airtable configuration (for Listings and Users – both in the same base)
let airtableConfig = {
  apiKey: process.env.AIRTABLE_API_KEY || 'YOUR_KEY',  // Replace with your API key or set it as an environment variable
  baseId: process.env.AIRTABLE_BASE_ID || 'BASE_ID',    // Replace with your Base ID or set it as an environment variable
  tableName: 'Listings'
};

// Function to get the Airtable base instance
function getAirtableBase() {
  const Airtable = require('airtable');
  Airtable.configure({
    apiKey: airtableConfig.apiKey
  });
  return Airtable.base(airtableConfig.baseId);
}

const app = express();
const port = process.env.PORT || 3000;

// Set up EJS templating
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files from the public folder
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to parse form data
app.use(bodyParser.urlencoded({ extended: true }));

// Session middleware for user authentication
app.use(session({
  secret: 'your-secret-key', // Replace with a secure key in production
  resave: false,
  saveUninitialized: false,
}));

/* ============================================================
   Authentication & User Management Routes (Using Airtable)
   ============================================================ */

// GET route for the login page
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

// POST route to handle login form submissions
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const base = getAirtableBase();
  base("Users").select({
    filterByFormula: `email = '${email}'`
  }).firstPage((err, records) => {
    if (err) {
      console.error(err);
      return res.render('login', { error: 'Error logging in. Please try again.' });
    }
    if (records.length > 0) {
      const userRecord = records[0];
      if (userRecord.fields.password === password) {
        req.session.user = {
          id: userRecord.id, 
          name: userRecord.fields.name,
          email: userRecord.fields.email,
          role: userRecord.fields.role,
          listingdone: userRecord.fields.listingdone || 0
        };
        if (req.session.user.role === 'admin') {
          return res.redirect('/admin');
        } else {
          return res.redirect('/dashboard');
        }
      } else {
        return res.render('login', { error: 'Invalid email or password.' });
      }
    } else {
      return res.render('login', { error: 'Invalid email or password.' });
    }
  });
});




// GET route for the registration page
app.get('/register', (req, res) => {
  res.render('register', { error: null });
});

// POST route to handle user registration
app.post('/register', (req, res) => {
  const { name, email, password, confirmPassword } = req.body;
  if (password !== confirmPassword) {
    return res.render('register', { error: 'Passwords do not match.' });
  }
  const base = getAirtableBase();
  // Check if a user with this email already exists
  base("Users").select({
    filterByFormula: `email = '${email}'`
  }).firstPage((err, records) => {
    if (err) {
      console.error(err);
      return res.render('register', { error: 'Error during registration. Please try again.' });
    }
    if (records.length > 0) {
      return res.render('register', { error: 'A user with that email already exists.' });
    }
    // Create a new user record in the "Users" table
    base("Users").create({
      name: name,
      email: email,
      password: password,
      listingdone: 0,
      role: 'user'
    }, (err, record) => {
      if (err) {
        console.error(err);
        return res.render('register', { error: 'Error creating user. Please try again.' });
      }
      // Log the user in immediately after registration
      req.session.user = {
        id: record.id,
        name: record.fields.name,
        email: record.fields.email,
        role: record.fields.role,
        listingdone: record.fields.listingdone
      };
      res.redirect('/dashboard');
    });
  });
});

// GET route for account settings
app.get('/settings', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  const base = getAirtableBase();
  // Retrieve the current user's record from the "Users" table
  base("Users").find(req.session.user.id, (err, record) => {
    if (err) {
      console.error(err);
      return res.send('Error fetching user settings.');
    }
    res.render('settings', { user: record.fields, error: null, success: null });
  });
});

// POST route to update account settings
app.post('/settings', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  const { name, email, password } = req.body;
  const base = getAirtableBase();
  // Update the current user's record in the "Users" table
  base("Users").update(req.session.user.id, {
    name: name,
    email: email,
    password: password
  }, (err, record) => {
    if (err) {
      console.error(err);
      return res.render('settings', { user: req.body, error: 'Error updating settings', success: null });
    }
    // Update session info
    req.session.user.name = record.fields.name;
    req.session.user.email = record.fields.email;
    res.render('settings', { user: record.fields, error: null, success: 'Settings updated successfully!' });
  });
});

// Logout route to end the session
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

/* ============================================================
   Application Routes (Listings & Admin)
   ============================================================ */

// Updated User Dashboard route with Airtable Listings integration
// Updated User Dashboard route using the recuserId lookup field
app.get('/dashboard', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.redirect('/login');
  }
  const base = getAirtableBase();
  base(airtableConfig.tableName).select({
    // Use the lookup field "recuserId" in the filter formula
    filterByFormula: `FIND('${req.session.user.id}', ARRAYJOIN({recuserId})) > 0`
  }).firstPage((err, records) => {
    if (err) {
      console.error(err);
      return res.send('Error fetching listings from Airtable.');
    }
    const listings = records.map(record => ({
      id: record.id,
      ...record.fields
    }));
    res.render('dashboard', { user: req.session.user, listings });
  });
});



// GET route to view a single listing
app.get('/listings/view/:id', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.redirect('/login');
  }
  const base = getAirtableBase();
  base(airtableConfig.tableName).find(req.params.id, (err, record) => {
    if (err) {
      console.error(err);
      return res.send('Error fetching listing details.');
    }
    res.render('listing_view', { 
      user: req.session.user, 
      listing: record.fields, 
      id: record.id 
    });
  });
});


// GET route to display the form for editing a listing
app.get('/listings/edit/:id', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.redirect('/login');
  }
  const base = getAirtableBase();
  base(airtableConfig.tableName).find(req.params.id, (err, record) => {
    if (err) {
      console.error(err);
      return res.send('Error fetching listing for editing.');
    }
    res.render('edit_listing', { 
      user: req.session.user, 
      listing: record.fields, 
      id: record.id,
      error: null 
    });
  });
});



// POST route to handle updating a listing
app.post('/listings/edit/:id', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.redirect('/login');
  }
  const { name, status, notes } = req.body;
  const base = getAirtableBase();
  base(airtableConfig.tableName).update(req.params.id, {
    name: name,
    status: status,
    notes: notes
  }, (err, record) => {
    if (err) {
      console.error(err);
      return res.render('edit_listing', { 
        user: req.session.user, 
        listing: req.body, 
        id: req.params.id,
        error: 'Error updating listing. Please try again.' 
      });
    }
    res.redirect('/dashboard');
  });
});


// GET route to delete a listing
app.get('/listings/delete/:id', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.redirect('/login');
  }
  const base = getAirtableBase();
  base(airtableConfig.tableName).destroy(req.params.id, (err, deletedRecord) => {
    if (err) {
      console.error(err);
      return res.send('Error deleting listing.');
    }
    res.redirect('/dashboard');
  });
});



// GET route to display the form for creating a new listing
app.get('/listings/new', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.redirect('/login');
  }
  res.render('new_listing', { user: req.session.user, error: null });
});

// POST route to handle creation of a new listing
app.post('/listings/new', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.redirect('/login');
  }
  // Extract fields from the form (adjust field names as needed)
  const { name, status, notes } = req.body;
  const base = getAirtableBase();
  // Create a new record in the Listings table and associate it with the logged-in user
  base(airtableConfig.tableName).create({
    name: name,
    status: status,
    notes: notes,
    userId: [ req.session.user.id ]
  }, (err, record) => {
    if (err) {
      console.error(err);
      return res.render('new_listing', { user: req.session.user, error: 'Error creating listing. Please try again.' });
    }
    res.redirect('/dashboard');
  });
});

// Admin Dashboard: View Airtable configuration and update it
app.get('/admin', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }
  res.render('admin', { user: req.session.user, config: airtableConfig, message: null });
});

// Handle updates to the Airtable configuration from the admin dashboard
app.post('/admin', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }
  const { apiKey, baseId, tableName } = req.body;
  airtableConfig = { apiKey, baseId, tableName };
  res.render('admin', { user: req.session.user, config: airtableConfig, message: 'Configuration updated successfully!' });
});

// Redirect the root URL to the login page
app.get('/', (req, res) => {
  res.redirect('/login');
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
