const express = require('express');
const middlewares = require('./middlewares');
const app = express();

app.set('view engine', 'ejs');
app.use(express.static('../public'));
app.use(middlewares.sessionMiddleware);

app.use('/auth', require('../routes/auth'));
// app.use('', require('../routes/routes'));

app.get('/player_socket', middlewares.assertSession, (req, res) => {
	res.render('player_socket');
});

