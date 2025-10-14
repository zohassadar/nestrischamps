import pg from 'pg';

let pool;

const isPublicServer = /^(1|on|true)$/i.test(process.env.IS_PUBLIC_SERVER);
const pgUser = process.env.POSTGRES_USER;
const pgDb = process.env.POSTGRES_DB;
const pgPass = process.env.POSTGRES_PASSWORD;
const dbUrl = process.env.DATABASE_URL;
const connectionString = dbUrl
	? dbUrl
	: `postgres://${pgUser}:${pgPass}@localhost:5432/${pgDb}?sslmode=disable`;

console.log(`DB initialization`, {
	IS_PUBLIC_SERVER: isPublicServer,
});

pool = new pg.Pool({
	connectionString: connectionString,
	ssl: {
		rejectUnauthorized: false, // isPublicServer,
	},
});

// the pool will emit an error on behalf of any idle clients
// it contains if a backend error or network partition happens
pool.on('error', err => {
	console.error('DB: Unexpected error on idle client', err);
});

export default pool;
