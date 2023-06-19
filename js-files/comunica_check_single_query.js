"use strict";
class runExperiments {
    constructor() {
        this.queryEngineFactory = require("@comunica/query-sparql-file").QueryEngineFactory;
    }
    async createEngine() {
        // this.engine = await new this.queryEngineFactory().create({configPath: "configFiles/config-default-variable-priorities.json"});
        this.engine = await new this.queryEngineFactory().create();
    }
    getTimeSeconds() {
        const hrTime = process.hrtime();
        const time = hrTime[0] + hrTime[1] / 1000000000;
        return time;
    }
}
const query = `SELECT ?v0 ?v1 ?v3 WHERE {
	?v0 <http://purl.org/dc/terms/Location> ?v1 .
	?v0 <http://schema.org/nationality> <http://db.uwaterloo.ca/~galuc/wsdbm/Country24> .
	?v0 <http://db.uwaterloo.ca/~galuc/wsdbm/gender> ?v3 .
	?v0 <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://db.uwaterloo.ca/~galuc/wsdbm/Role2> .
}`;
const runner = new runExperiments();
runner.createEngine().then(async () => {
    const startTime = runner.getTimeSeconds();
    const outputStream = await runner.engine.queryBindings(query, { sources: ["output/dataset.nt"] });
    let numResults = 0;
    const timingResults = [];
    outputStream.on('data', (res) => {
        console.log(res.entries);
        numResults += 1;
        timingResults.push(runner.getTimeSeconds() - startTime);
    });
    outputStream.on('end', () => {
        const elapsed = runner.getTimeSeconds() - startTime;
        console.log(`Total execution time: ${elapsed}`);
        console.log(`Number of results: ${numResults}`);
        console.log(`Result arrival distribution: ${timingResults}`);
    });
});
//# sourceMappingURL=comunica_check_single_query.js.map