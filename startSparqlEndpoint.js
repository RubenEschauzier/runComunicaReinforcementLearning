"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const actor_init_query_1 = require("@comunica/actor-init-query");
const cluster = require("cluster");
const defaultConfigPath = `${__dirname}/../config/config-default.json`;
actor_init_query_1.HttpServiceSparqlEndpoint.runArgsInProcess(process.argv.slice(2), process.stdout, process.stderr, `${__dirname}/../`, process.env, defaultConfigPath, code => process.exit(code))
    .catch(error => process.stderr.write(`${error.message}/n`));
console.log("Testtestestes");
console.log(cluster.isMaster);
//# sourceMappingURL=startSparqlEndpoint.js.map