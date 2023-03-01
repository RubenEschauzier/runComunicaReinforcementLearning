"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const actor_init_query_1 = require("@comunica/actor-init-query");
const run_comunica_experience_replay_1 = require("./run_comunica_experience_replay");
const cluster = require("cluster");
const path = require("path");
const defaultConfigPath = path.join(__dirname, "../../../comunica-rl-updated/engines/query-sparql-file/bin/") + "../config/config-default.json";
const moduleRootPath = path.join(__dirname, "../../../comunica-rl-updated/engines/query-sparql-file/bin/") + "../";
const runningMomentsFeatureFile = "../../actor-rdf-join-inner-multi-reinforcement-learning-tree/model/moments/" + "runningMomentsFeatures" + 1 + ".json";
const batchedTrainExamples = { trainingExamples: new Map, leafFeatures: { hiddenStates: [], memoryCell: [] } };
// Need to pass to SPARQL endpoint context: 
// {runningMomentsFeatureFile, timeout, invalidateCacheBeforeQuery, sources, train:true, batchedTrainExamples (NEEDS TO BE REUSED IN TRAINING)}
function createEndpoint(stdout, stderr, exit) {
    const options = { moduleRootPath: moduleRootPath, mainModulePath: moduleRootPath, defaultConfigPath: defaultConfigPath,
        configPath: defaultConfigPath,
        context: {
            sources: ['missingGenreOutput/dataset.nt'],
            runningMomentsFeatureFile: runningMomentsFeatureFile,
            train: true,
            batchedTrainingExamples: batchedTrainExamples
        },
        timeout: 1000, invalidateCacheBeforeQuery: true };
    return new Promise(resolve => {
        const endPoint = new actor_init_query_1.HttpServiceSparqlEndpoint(options || {}).run(stdout, stderr)
            .then((result) => resolve(result))
            .catch(error => {
            stderr.write(error);
            exit(1);
            resolve(endPoint);
        });
        resolve(endPoint);
    });
}
;
function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
const doneCreating = createEndpoint(process.stdout, process.stderr, code => process.exit(code));
if (cluster.isMaster) {
    doneCreating.then(async () => {
        // Wait for the worker to create comunica, bit hacky
        await sleep(25000);
        console.log("Done!");
        const numSim = 1;
        const numSimVal = 5;
        const numExperiencePerSim = 8;
        const nEpochs = 40;
        const sizeBuffer = 2000;
        // Actual engine used for training
        // const trainEngine = new trainComunicaModel(sizeBuffer);
        // const loadingTrain = trainEngine.loadWatDivQueries('missingGenreOutput/queries', false);
        // const loadingValidation = trainEngine.loadWatDivQueries('missingGenreOutput/queriesVal', true);
        // loadingTrain.then(async ()=>{
        //     await loadingValidation;
        //     let cleanedQueriesVal: string[][] = trainEngine.valQueries.map(x => x.replace(/\n/g, '').replace(/\t/g, '').split('SELECT'));
        //     let cleanedQueries: string[][] = trainEngine.queries.map(x => x.replace(/\n/g, '').replace(/\t/g, '').split('SELECT'));
        //     for (let i = 0; i<cleanedQueries.length;i++){
        //         cleanedQueries[i].shift();
        //         cleanedQueriesVal[i].shift();
        //         for(let j=0;j<cleanedQueries[i].length;j++){
        //             cleanedQueries[i][j] = 'SELECT' + cleanedQueries[i][j];
        //         }
        //         for(let k=0; k<cleanedQueriesVal[i].length;k++){
        //             cleanedQueriesVal[i][k] = 'SELECT' + cleanedQueriesVal[i][k]
        //         }
        //     }
        //     await trainEngine.awaitEngine();
        //     trainEngine.engine.queryBindingsTrain(cleanedQueries, cleanedQueriesVal, 1,1,1,1, 100, batchedTrainExamples, {sources: ["missingGenreOutput/dataset.nt"]} );
        // });
    });
}
// HttpServiceSparqlEndpoint.runArgsInProcess(["missingGenreOutput/dataset.nt"], process.stdout, process.stderr, `${__dirname}/../`, process.env, defaultConfigPath, code => process.exit(code))
//   .catch(error => process.stderr.write(`${error.message}/n`));
if (cluster.isMaster) {
    const numSim = 1;
    const numSimVal = 5;
    const numExperiencePerSim = 8;
    const nEpochs = 40;
    const sizeBuffer = 2000;
    // Actual engine used for training
    const trainEngine = new run_comunica_experience_replay_1.trainComunicaModel(sizeBuffer);
    const loadingTrain = trainEngine.loadWatDivQueries('missingGenreOutput/queries', false);
    const loadingValidation = trainEngine.loadWatDivQueries('missingGenreOutput/queriesVal', true);
    loadingTrain.then(async () => {
        await loadingValidation;
        let cleanedQueriesVal = trainEngine.valQueries.map(x => x.replace(/\n/g, '').replace(/\t/g, '').split('SELECT'));
        let cleanedQueries = trainEngine.queries.map(x => x.replace(/\n/g, '').replace(/\t/g, '').split('SELECT'));
        for (let i = 0; i < cleanedQueries.length; i++) {
            cleanedQueries[i].shift();
            cleanedQueriesVal[i].shift();
            for (let j = 0; j < cleanedQueries[i].length; j++) {
                cleanedQueries[i][j] = 'SELECT' + cleanedQueries[i][j];
            }
            for (let k = 0; k < cleanedQueriesVal[i].length; k++) {
                cleanedQueriesVal[i][k] = 'SELECT' + cleanedQueriesVal[i][k];
            }
        }
        await trainEngine.awaitEngine();
        trainEngine.engine.queryBindingsTrain(cleanedQueries, cleanedQueriesVal, 1, 1, 1, 1, 100, batchedTrainExamples, { sources: ["missingGenreOutput/dataset.nt"] });
    });
}
//# sourceMappingURL=startSparqlEndpoint.js.map