import tracer from 'dd-trace';

tracer.init();

tracer.use('express', {
	middleware: false,
});

export default tracer;
