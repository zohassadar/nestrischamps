// This module provides capability to import user profiles to the NTC Database
import dbPool from './db.js';
import { parse } from 'csv-parse/sync';
import { ulid } from 'ulid';
import got from 'got';

import ScoreDAO from '../daos/ScoreDAO.js';

function identity(v) {
	return v;
}

// need to return values that match DB enum
function getStyle(entry) {
	if (/hybrid/i.test(entry)) return 'hybrid';
	if (/das/i.test(entry)) return 'das';
	if (/tap/i.test(entry)) return 'tap';
	if (/roll/i.test(entry)) return 'roll';
}

function getCompetitonWins(entry) {
	entry = entry?.trim();
	if (!entry) return '';
	if (/^(no|n\/?a)$/i.test(entry)) return '';
	return entry;
}

function getUsefulEntry(entry) {
	entry = entry?.trim();
	if (!entry) return '';
	if (/^(no|n\/?a)$/i.test(entry)) return '';
	return entry;
}

function getMaxouts(num) {
	num = num?.trim();
	if (!num) return '';
	if (num === '0') return '';
	if (num === '1') return '1 maxout';
	return `${num} maxouts`;
}

function getRivalAndReason(entry) {
	entry = entry?.trim();

	if (!entry) return { rival: '', reason: '' };

	const regex = /^(.+?)(?:\s*([,;(.!\r\n\t]|because|cause|but)\s*)(.+)$/is;
	const match = entry.match(regex);

	if (!match) return { rival: entry, reason: '' };

	const rival = match[1].trim();
	const delimiter = match[2];
	const reason = /^[a-z]/i.test(delimiter)
		? delimiter + ' ' + match[3].trim()
		: match[3].trim();

	return { rival, reason };
}

const _importUsers = async (
	dbClient,
	csvURL,
	{ clearOldUsers } = { clearOldUsers: true }
) => {
	const records_csv_content = await got(csvURL).text();
	const records = parse(records_csv_content, {
		skip_empty_lines: true,
	});

	const START_ID = 33;
	const errors = [];

	// BEWARE - Hardcoded order of fields from sheet
	const CSV_FIELDS = [
		'seed',
		'display_name',
		'country',
		'state',
		'pronouns',
		'twitch',
		'controller',
		'pb18',
		'pb19',
		'lines29',
		'pb29',
		'highest_level',
		'num_maxouts',
		'age',
		'job',
		'style',
		'rival',
		'favourite_other_game',
		'favourite_sport_team',
		'num_year_qualified_ctwc',
		'highest_rank_and_year',
		'competition_wins',
		'achievements',
		'hobbies',
	];

	const NUMERIC_FIELDS = [
		'seed',
		'pb18',
		'pb19',
		'pb29',
		'lines29',
		'highest_level',
		'num_maxouts',
		'age',
	];

	// 1. we extract all records from the sheet and convert that in NTC-compatible player data
	const players = records.slice(1).map((record, index) => {
		const id = START_ID + index;
		const csv = Object.fromEntries(
			CSV_FIELDS.map((key, i) => [key, record[i]])
		);
		const player_errors = [];

		// verify numeric fields
		for (const field of NUMERIC_FIELDS) {
			if (!/^([1-9]\d*(\.\d*[1-9])?(E\+\d+)?|)$/.test(csv[field].trim())) {
				player_errors.push(
					`${field} is not a valid numerical value: [${csv[field]}]`
				);
			}
		}

		if (csv.display_name.length > 11) {
			player_errors.push(
				`short name is longer than 10 characters (${csv.display_name.length} chars): [${csv.display_name}]`
			);
		}

		if (Math.trunc(Number(csv.num_maxouts)) > 10000) {
			player_errors.push(`Number of maxout > 10,000:[${csv.num_maxouts}]`);
		}

		errors.push(...player_errors.map(err => ({ index, csv, err })));

		return { id, csv, errors: player_errors };
	});

	// show all errors by row for quick fixes
	if (errors.length) {
		errors.sort((e1, e2) => e1.index - e2.index);
		console.error(`ERROR: Unexpected values found in data sheet`);
		console.error('----------');
		console.error(
			errors
				.map(
					({ index, csv, err }) =>
						`row ${index + 2} (${csv.display_name}): ${err}`
				)
				.join('\n')
		);
		// process.exit(1);
	}

	// 2. Transform data and Derive NTC values
	players.forEach(player => {
		const { id, csv } = player;

		// prep ntc mapped values
		const { rival, reason: rival_reason } = getRivalAndReason(
			getUsefulEntry(csv.rival)
		);
		const ntc = {
			id,
			login: /^\s*$/.test(csv.twitch) ? `__user${id}` : csv.twitch,
			email: `__user${id}@nestrischamps.io`,
			display_name: csv.seed
				? `${csv.seed}. ${csv.display_name}`
				: csv.display_name,
			secret: ulid(),
			description: [
				csv.job.trim(),
				getCompetitonWins(csv.competition_wins),
				getUsefulEntry(csv.achievements),
				getMaxouts(csv.num_maxouts),
			]
				.filter(identity)
				.join('\n'), // do we want that default?? probably not
			pronouns: csv.pronouns.trim(),
			profile_image_url: '',
			dob: new Date(),
			country_code: csv.country.trim(),
			city: csv.state?.trim() || '',
			interests: [
				getUsefulEntry(csv.hobbies),
				getUsefulEntry(csv.favourite_other_game),
				getUsefulEntry(csv.favourite_sport_team),
			]
				.filter(identity)
				.join('\n'),
			style: getStyle(csv.style),
			controller: /goof/i.test(csv.controller)
				? 'goofy-foot'
				: /hyperkin|cadet/i.test(csv.controller)
					? 'hyperkin-cadet'
					: /nes|original|standard|oem|stock/i.test(csv.controller)
						? 'nes'
						: 'other',
			rival,
			rival_reason,
			elo_rank: 0,
			elo_rating: 0,
		};

		const age = parseInt(csv.age, 10);
		const dob = ntc.dob;
		dob.setFullYear(dob.getFullYear() - age);
		dob.setDate(dob.getDate() - 1);

		player.ntc = ntc;
	});

	if (clearOldUsers) {
		await dbClient.query('DELETE FROM users WHERE id>32');
	}

	// 3. Inject NTC record into DB!
	for (const { ntc, csv } of players) {
		const {
			id,
			login,
			// email,
			secret,
			display_name,
			pronouns,
			elo_rank,
			elo_rating,
			description,
			dob,
			country_code,
			city,
			interests,
			style,
			controller,
			rival,
			rival_reason,
			profile_image_url,
		} = ntc;

		try {
			await dbClient.query(
				`INSERT INTO users
				(id, login, secret, description, display_name, pronouns, profile_image_url, dob, country_code, city, interests, style, controller, rival, rival_reason, elo_rank, elo_rating, created_at, last_login_at)
				VALUES
				($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), NOW())
				ON CONFLICT (id)
				DO UPDATE SET login=$2, secret=$3, description=$4, display_name=$5, pronouns=$6, profile_image_url=$7, dob=$8, country_code=$9, city=$10, interests=$11, style=$12, controller=$13, rival=$14, rival_reason=$15, elo_rank=$16, elo_rating=$17, last_login_at=NOW()
				`,
				[
					id,
					login,
					secret,
					description,
					display_name,
					pronouns,
					profile_image_url,
					dob,
					country_code,
					city,
					interests,
					style,
					controller,
					rival,
					rival_reason,
					elo_rank,
					elo_rating,
				]
			);
		} catch (err) {
			console.error('Invalid Record');
			console.error(ntc);
			throw err;
		}

		const pbs = [
			{
				start: 18,
				pb: csv.pb18,
			},
			{
				start: 19,
				pb: csv.pb19,
			},
			{
				start: 29,
				pb: csv.pb29,
			},
		];

		for (const { start, pb } of pbs) {
			if (!pb.trim()) continue;

			const score = parseInt(pb, 10);

			await ScoreDAO.setPB(
				{ id },
				{
					start_level: start,
					end_level: start,
					score,
				}
			);
		}
	}

	console.log(`DONE - Inserted ${players.length} players`);

	return { players };
};

export const importUsers = async options => {
	if (process.env.LOCAL_USERS_ALLOW_IMPORT !== '1') return;

	// verify we are with a local DB
	const dbURL = new URL(dbPool.options.connectionString);

	if (
		!/^(192\.168(\.\d{1,3}){2}|localhost|127.0.0.1)$|\.local$/.test(
			dbURL.hostname
		)
	) {
		console.error(
			`DB hostname is NOT localhost or LAN IP or local domain: ${dbURL.hostname} - ABORTING`
		);
		throw new Error(`Operation importUsers() is not allowed to run`);
	}

	const csvURL = process.env.LOCAL_USERS_CSV_URL;

	if (!csvURL) {
		console.error(`User CSV URL is not provided - ABORTING`);
		throw new Error(`Operation importUsers() cannot find the user CSV URL`);
	}

	const dbClient = await dbPool.connect();

	try {
		return await _importUsers(dbClient, csvURL, options);
	} catch (err) {
		console.error(`Unable to import local users: `, err);
		throw err;
	} finally {
		dbClient.release();
	}
};

if (
	process.env.IN_SCRIPT !== '1' &&
	/^[1-9]\d+$/.test(process.env.LOCAL_USERS_REFRESH)
) {
	setInterval(importUsers, parseInt(process.env.LOCAL_USERS_REFRESH) * 1000);
}
