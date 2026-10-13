export const peerServerOptions = {
	host: 'zopi.local',
	path: '/',
	port: 9000,
	secure: true,
	config: {
		iceServers: [
			{ urls: ['stun:zopi.local:3478'] },
			{
				urls: ['turn:zopi.local:3478'],
				username: 'ntc',
				credential: 'ntc',
			},
		],
	},
};
