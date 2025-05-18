CREATE TYPE controller_type AS ENUM ('nes', 'goofy-foot', 'hyperkin-cadet', 'keyboard', 'other');

ALTER TABLE users
	ADD COLUMN controller controller_type default 'nes',
	ADD COLUMN rival VARCHAR ( 300 ) default ''
;
