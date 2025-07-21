import express from 'express';
import middlewares from './middlewares.js';
import cors from 'cors';

// crude way to prevent crashes
// not recommended since application is now in an undefined state
// still, with daily restarts, any unknown state is guaranteed to clear soon
process.on('uncaughtException', (error, origin) => {
	console.error('uncaughtException');
	console.error(error);
	console.error(origin);
});

const app = express();

app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('trust proxy', 1); // trust first proxy (i.e. heroku) -- needed to get req.protocol correctly

app.use(cors());

const pMap = {
	http: 'https',
	https: 'https',
	ws: 'wss',
	wss: 'wss',
};

// heroku redirector
app.use((req, res, next) => {
	if (process.env.IS_LIVE_HEROKU) {
		if (req.hostname === 'nestrischamps.herokuapp.com') {
			res.redirect(
				301,
				`${pMap[req.protocol]}://nestrischamps.io${req.originalUrl}`
			);
			return;
		}
	}

	next();
});

// app-level middleware to block .php and wordpress requests BEFORE static and session middlewares run
// because I'm seeing lots of annoying kiddy-scans, which still hammer the DB with session checks -_-
app.use((req, res, next) => {
	if (/\/wp-|\.php7?$/i.test(req.path)) {
		return res.status(404).send('Not Found');
	}
	next();
});

app.use(express.static('public'));
app.use(middlewares.sessionMiddleware);

// set up some reusable template data
app.use((req, res, next) => {
	res.locals.user = req.session.user;

	if (!req.session.user) {
		// Since there's no session in use
		// We prep for when user might login

		if (req.originalUrl) {
			if (!/^\/(api|auth|favicon|android|apple|site)/.test(req.originalUrl)) {
				console.log('Storing auth_success_redirect', req.originalUrl);
				req.session.auth_success_redirect = req.originalUrl;
			}
		}
	}

	next();
});

import authRoutes from '../routes/auth.js';
import apiRoutes from '../routes/api.js';
import scoreRoutes from '../routes/score.js';
import settingsRoute from '../routes/settings.js';
import systemRoute from '../routes/system.js';
import defaultRoutes from '../routes/routes.js';

app.use('/auth', authRoutes);
app.use('/api', apiRoutes);
app.use('/stats', scoreRoutes);
app.use('/settings', settingsRoute);
app.use('/system', systemRoute);
app.use('', defaultRoutes);

export default app;
