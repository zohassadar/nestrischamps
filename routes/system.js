import express from 'express';
import nocache from 'nocache';

import middlewares from '../modules/middlewares.js';
import { importUsers } from '../modules/LocalUsers.js';

const router = express.Router();

router.use(middlewares.assertSession);
router.use(middlewares.checkToken);
router.use(nocache());

router.get('/import-local-users', async (req, res) => {
	const data = await importUsers({
		clearOldUsers: req.query.clear === '1',
	});

	res.json(data);
});

export default router;
