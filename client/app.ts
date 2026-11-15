import { createAnswer } from './src/sources';

const API = import.meta.env.API_BASE_URL ?? 'http://127.0.0.1:7777';
const MOCK_SETTING = import.meta.env.VELA_MOCK ?? '0';
const MOCK = String(MOCK_SETTING) === '1';
const VERSION = import.meta.env.VELA_BUILD_VERSION ?? '0.1.0';
export const grants = `net.fetch https:\nnet.fetch http:\nsecret.keep vela.session\nsecret.keep vela.counter\nsecret.keep vela.device\nsecret.keep vela.servers\nsecret.keep vela.server-sessions`;
export const answer = createAnswer(API, MOCK, VERSION);
