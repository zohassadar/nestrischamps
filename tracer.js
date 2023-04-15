import tracer from 'dd-trace';

tracer.init({
	logInjection: true, // https://docs.datadoghq.com/tracing/other_telemetry/connect_logs_and_traces/nodejs/
});

/*
tracer.use('express', {
	middleware: false,
});

tracer.use('pg', {
	service: 'pg'
});
/**/

export default tracer;
