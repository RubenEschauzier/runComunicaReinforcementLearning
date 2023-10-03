import * as fs from 'fs';
import { ISparqlBenchmarkRunnerArgs, SparqlBenchmarkRunner } from './sparql_benchmark_runner';
import * as path from 'path';


function getQuerySets(queryDir: string){
    const querySets: Record<string, string[]> = {};
    const dirFiles = fs.readdirSync(queryDir);

    for (const [i, queryFile] of dirFiles.entries()){
        const query = fs.readFileSync(path.join(queryDir, queryFile), 'utf-8');
        querySets[queryFile] = [query];
    }
    return querySets;
}
async function main(){
    const querySets = getQuerySets('queriesTest');
    const optionsRunner: ISparqlBenchmarkRunnerArgs = {
        endpoint: "http://localhost:3000/sparql", 
        querySets: querySets, 
        replication: 1, 
        warmup: 0, 
        timestampsRecording: true,
        logger: console.log,
        upQuery: "SELECT * WHERE { ?s ?p ?o } LIMIT 1"
    };
    const SparqlQueryRunner = new SparqlBenchmarkRunner(optionsRunner);
    const results = await SparqlQueryRunner.run();
}
// This should be equal to "logFileQueueEvolution" in engines/config-query-sparql-link-traversal/config/config-solid-default-priority.json

const queryLogPath = "/tmp/queueAnalysis/";
main()
