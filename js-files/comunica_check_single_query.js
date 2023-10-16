"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class runExperiments {
    constructor() {
        this.queryEngineFactory = require("@comunica/query-sparql-file").QueryEngineFactory;
    }
    async createEngine() {
        // this.engine = await new this.queryEngineFactory().create({configPath: "configFiles/config-default-variable-priorities.json"});
        this.engine = await new this.queryEngineFactory().create();
    }
    async consumeStream(bindingStream, startTime) {
        let numResults = 0;
        const timingResults = [];
        const finishedReading = new Promise((resolve, reject) => {
            bindingStream.on('data', (res) => {
                numResults += 1;
                timingResults.push(runner.getTimeSeconds() - startTime);
            });
            bindingStream.on('end', () => {
                const elapsed = runner.getTimeSeconds() - startTime;
                console.log(`Total execution time: ${elapsed}`);
                console.log(`Number of results: ${numResults}`);
                console.log(`Result arrival distribution: ${timingResults}`);
                resolve(true);
            });
            bindingStream.on('error', () => {
                reject(true);
            });
        });
        return finishedReading;
    }
    getTimeSeconds() {
        const hrTime = process.hrtime();
        const time = hrTime[0] + hrTime[1] / 1000000000;
        return time;
    }
}
const queryComplex = `SELECT ?v0 ?v4 ?v6 ?v7 WHERE {
	?v0 <http://schema.org/caption> ?v1 .
	?v0 <http://schema.org/text> ?v2 .
	?v0 <http://schema.org/contentRating> ?v3 .
	?v0 <http://purl.org/stuff/rev#hasReview> ?v4 .
	?v4 <http://purl.org/stuff/rev#title> ?v5 .
	?v4 <http://purl.org/stuff/rev#reviewer> ?v6 .
	?v7 <http://schema.org/actor> ?v6 .
	?v7 <http://schema.org/language> ?v8 .
}`;
const query = `SELECT ?v0 ?v1 ?v3 WHERE {
	?v0 <http://purl.org/dc/terms/Location> ?v1 .
	?v0 <http://schema.org/nationality> <http://db.uwaterloo.ca/~galuc/wsdbm/Country24> .
	?v0 <http://db.uwaterloo.ca/~galuc/wsdbm/gender> ?v3 .
	?v0 <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://db.uwaterloo.ca/~galuc/wsdbm/Role2> .
}`;
const numRuns = 20;
const runner = new runExperiments();
runner.createEngine().then(async () => {
    for (let i = 0; i < numRuns; i++) {
        const startTime = runner.getTimeSeconds();
        const outputStream = await runner.engine.queryBindings(query, { sources: ["/tmp/dataset.nt"], trainEndPoint: true });
        await runner.consumeStream(outputStream, startTime).catch(err => alert(err));
        // let numResults = 0;
        // const timingResults: number[] = [];
        // outputStream.on('data', (res: any) => {
        //     console.log(res.entries)
        //     numResults += 1;
        //     timingResults.push(runner.getTimeSeconds() - startTime)
        // });
        // outputStream.on('end', () =>{
        //     const elapsed = runner.getTimeSeconds() - startTime;
        //     console.log(`Total execution time: ${elapsed}`);
        //     console.log(`Number of results: ${numResults}`);
        //     console.log(`Result arrival distribution: ${timingResults}`);
        // });    
    }
    ;
});
//# sourceMappingURL=comunica_check_single_query.js.map