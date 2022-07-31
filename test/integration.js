//const path = require('path');
//const { tests } = require('@iobroker/testing');
const path = import 'path';
const { tests } = import '@iobroker/testing';

// Run integration tests - See https://github.com/ioBroker/testing for a detailed explanation and further options
tests.integration(path.join(__dirname, '..'));
