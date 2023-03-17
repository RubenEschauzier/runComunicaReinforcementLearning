import { HttpServiceSparqlEndpoint, IHttpServiceSparqlEndpointArgs } from '@comunica/actor-init-query';
import {trainComunicaModel} from './run_comunica_experience_replay';
import * as cluster from 'cluster';
import type { Writable } from 'stream';
import * as path from 'path'
import { IBatchedTrainingExamples, ITrainingExample } from '@comunica/types';


const defaultConfigPath = path.join(__dirname, "../../../comunica-rl-updated/engines/query-sparql-file/bin/")+"../config/config-default.json";
const moduleRootPath = path.join(__dirname, "../../../comunica-rl-updated/engines/query-sparql-file/bin/")+"../";
// const runningMomentsFeatureFile = "../../actor-rdf-join-inner-multi-reinforcement-learning-tree/model/moments/"+"runningMomentsFeatures"+1+".json";
const batchedTrainExamples: IBatchedTrainingExamples = {trainingExamples: new Map<string, ITrainingExample>, leafFeatures: {hiddenStates: [], memoryCell:[]}};

// Need to pass to SPARQL endpoint context: 
// {runningMomentsFeatureFile, timeout, invalidateCacheBeforeQuery, sources, train:true, batchedTrainExamples (NEEDS TO BE REUSED IN TRAINING)}

export function createEndPoint(stdout: Writable, stderr: Writable, exit: (code: number) => void){
    const options: IHttpServiceSparqlEndpointArgs = {moduleRootPath: moduleRootPath, mainModulePath: moduleRootPath, defaultConfigPath: defaultConfigPath, 
    configPath: defaultConfigPath, 
    context: 
    {
    sources: ['missingGenreOutput/dataset.nt'],  
    trainEndPoint: true, 
    batchedTrainingExamples: batchedTrainExamples
    }, 
    timeout: 5, invalidateCacheBeforeQuery: true}
    return new Promise<void>(resolve => {
        const endPoint = new HttpServiceSparqlEndpoint(options || {}).run(stdout, stderr)
          .then((result)=>resolve(result))
          .catch(error => {
            stderr.write(error);
            exit(1);
            resolve(endPoint);
          });
          resolve(endPoint)
    });
    
};

function sleep(ms: number) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
}
const doneCreating = createEndPoint(process.stdout, process.stderr, code => process.exit(code));
if (cluster.isMaster){
    doneCreating.then(async ()=>{
        // Wait for the worker to create comunica, bit hacky
        await sleep(25000); 
        console.log("Done!")
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
if (cluster.isMaster){
    const numSim = 1;
    const numSimVal = 5;
    const numExperiencePerSim = 8;
    const nEpochs = 40;
    const sizeBuffer = 2000;

    // Actual engine used for training
    const trainEngine = new trainComunicaModel(sizeBuffer);
    const loadingTrain = trainEngine.loadWatDivQueries('missingGenreOutput/queries', false);
    const loadingValidation = trainEngine.loadWatDivQueries('missingGenreOutput/queriesVal', true);

    loadingTrain.then(async ()=>{
        await loadingValidation;
        let cleanedQueriesVal: string[][] = trainEngine.valQueries.map(x => x.replace(/\n/g, '').replace(/\t/g, '').split('SELECT'));
        let cleanedQueries: string[][] = trainEngine.queries.map(x => x.replace(/\n/g, '').replace(/\t/g, '').split('SELECT'));
    
        for (let i = 0; i<cleanedQueries.length;i++){
            cleanedQueries[i].shift();
            cleanedQueriesVal[i].shift();
            for(let j=0;j<cleanedQueries[i].length;j++){
                cleanedQueries[i][j] = 'SELECT' + cleanedQueries[i][j];
            }
            for(let k=0; k<cleanedQueriesVal[i].length;k++){
                cleanedQueriesVal[i][k] = 'SELECT' + cleanedQueriesVal[i][k]
            }
        }
        await trainEngine.awaitEngine();
        
        trainEngine.engine.queryBindingsTrain(cleanedQueries, cleanedQueriesVal, 1,1,1,1, 100, batchedTrainExamples, {sources: ["missingGenreOutput/dataset.nt"]} );
    });
}
