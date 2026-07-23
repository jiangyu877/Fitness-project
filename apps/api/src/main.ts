import { buildApplication } from './application.js';
import { parseEnvironment } from './config/environment.js';

const environment = parseEnvironment(process.env);
const app = await buildApplication(environment);
await app.listen(environment.port);
