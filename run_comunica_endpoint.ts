import { IAggregateValues, IResultSetRepresentation, IRunningMoments } from "@comunica/mediator-join-reinforcement-learning";
import { BindingsStream, IBatchedTrainingExamples, ITrainingExample } from "@comunica/types";
import { ExperienceBuffer, IExperience, keyToIdx, updateRunningMoments } from "./helper";
import * as fs from 'fs';
import * as path from 'path';

// Command to create endpoint:
// node node_modules/@comunica/query-sparql-file/bin/http.js -c "{\"sources\":[\"missingGenreOutput/dataset.nt\"], \"trainEndPoint\":true}"

export class trainComunicaModel{
    public engine: any;
    public queries: string[];
    public valQueries:string[];
    public batchedTrainingExamples: IBatchedTrainingExamples;
    public batchedValidationExamples: IBatchedTrainingExamples;
    public runningMomentsExecutionTime: IRunningMoments;
    public experienceBuffer: ExperienceBuffer;

    public constructor(bufferSize: number){
        const QueryEngine = require('@comunica/query-sparql-file').QueryEngineFactory;
        this.engine = new QueryEngine().create();
        this.batchedTrainingExamples = {trainingExamples: new Map<string, ITrainingExample>, leafFeatures: {hiddenStates: [], memoryCell:[]}};
        this.batchedValidationExamples = {trainingExamples: new Map<string, ITrainingExample>, leafFeatures: {hiddenStates: [], memoryCell:[]}};
        this.queries=[];
        this.valQueries=[];
        this.runningMomentsExecutionTime = {indexes: [0], runningStats: new Map<number, IAggregateValues>()};
        for (const index of this.runningMomentsExecutionTime.indexes){
            const startPoint: IAggregateValues = {N: 0, mean: 0, std: 1, M2: 1}
            this.runningMomentsExecutionTime.runningStats.set(index, startPoint);
        }

        this.experienceBuffer = new ExperienceBuffer(bufferSize, this.queries.length);
    }

    public async executeQueryTrain(query: string, sources:string[], train:boolean, queryKey: string, runningMomentsFeatureFile?: string){
        const startTime: number = this.getTimeSeconds();
        const bindingsStream: BindingsStream = await this.engine.queryBindings(query, {sources: sources, batchedTrainingExamples: this.batchedTrainingExamples,
        runningMomentsFeatureFile: runningMomentsFeatureFile, train: train});
        const endTimeSearch = this.getTimeSeconds();
        if (train){
            if (this.engine.trainEpisode.joinsMade.length==0){
                this.engine.disposeTrainEpisode();
                this.engine.trainEpisode = {joinsMade: [], estimatedQValues: [], featureTensor: {hiddenStates:[], memoryCell:[]}, isEmpty:true};    
                return endTimeSearch-startTime;
                // throw new Error("Training episode contained 0 joins");
            }
            const joinOrderKeys: string[] = [];
            // Get joins made in this query to update
            for (let i = 1; i <this.engine.trainEpisode.joinsMade.length+1;i++){
                const joinIndexId = this.engine.trainEpisode.joinsMade.slice(0, i);
                joinOrderKeys.push(this.idxToKey(joinIndexId));
            }
            await this.addListener(bindingsStream, startTime, joinOrderKeys, queryKey, false, true);

            // Clear episode tensors
            this.engine.disposeTrainEpisode();
            this.engine.trainEpisode = {joinsMade: [], estimatedQValues: [], featureTensor: {hiddenStates:[], memoryCell:[]}, isEmpty:true};    
        }
        return endTimeSearch-startTime;
    }

    public async executeQueryValidation(query: string, sources:string[], queryKey: string){
        const startTime: number = this.getTimeSeconds();
        const bindingsStream: BindingsStream = await this.engine.queryBindings(query, {sources: sources, 
            batchedTrainingExamples: this.batchedValidationExamples, train: false});

        const joinOrderKeys: string[] = [];
        for (let i = 1; i <this.engine.trainEpisode.joinsMade.length+1;i++){
            const joinIndexId = this.engine.trainEpisode.joinsMade.slice(0, i);
            joinOrderKeys.push(this.idxToKey(joinIndexId));
        }    
        const exeuctionTimeRaw: number = await this.addListener(bindingsStream, startTime, joinOrderKeys, queryKey, true, false);
        this.engine.disposeTrainEpisode();
        this.engine.trainEpisode = {joinsMade: [], estimatedQValues: [], featureTensor: {hiddenStates:[], memoryCell:[]}, isEmpty:true};    
        return exeuctionTimeRaw;
    }

    public async executeQueryInitFeaturesBuffer(query: string, sources:string[]){
        const startTime: number = this.getTimeSeconds();
        const bindingsStream: BindingsStream = await this.engine.queryBindings(query, {sources: sources, 
            batchedTrainingExamples: this.batchedValidationExamples, train: true});
        const leafFeatures: IResultSetRepresentation = {hiddenStates: this.batchedValidationExamples.leafFeatures.hiddenStates.map(x=>x.clone()),
        memoryCell: this.batchedValidationExamples.leafFeatures.memoryCell.map(x=>x.clone())};

        this.engine.disposeTrainEpisode();
        this.engine.trainEpisode = {joinsMade: [], estimatedQValues: [], featureTensor: {hiddenStates:[], memoryCell:[]}, isEmpty:true};    
        this.cleanBatchTrainingExamplesValidation();
        return leafFeatures;
    }

    public cleanBatchTrainingExamples(){
        this.batchedTrainingExamples.leafFeatures.hiddenStates.map(x =>x.dispose());
        this.batchedTrainingExamples.leafFeatures.memoryCell.map(x=>x.dispose());
        this.batchedTrainingExamples = {trainingExamples: new Map<string, ITrainingExample>, leafFeatures: {hiddenStates: [], memoryCell:[]}};
    }

    public cleanBatchTrainingExamplesValidation(){
        this.batchedValidationExamples.leafFeatures.hiddenStates.map(x=>x.dispose());
        this.batchedValidationExamples.leafFeatures.memoryCell.map(x=>x.dispose());
        this.batchedValidationExamples = {trainingExamples: new Map<string, ITrainingExample>, leafFeatures: {hiddenStates: [], memoryCell:[]}};
    }


    public async loadWatDivQueries(queryDir: string, val:boolean){
        const loadingComplete = new Promise<boolean> (async (resolve, reject) => {
            try {
                // Get the files as an array
                const files = await fs.promises.readdir( queryDir );
                for( const file of files ) {
                    // Get the full paths
                    const filePath = path.join( queryDir, file );    
                    const data = fs.readFileSync(filePath,'utf8');
                    if (val){
                        this.valQueries.push(data);
                    }
                    else{
                        this.queries.push(data);
                    }
                }
                resolve(true); 
            }
            catch( e ) {
                console.error( "Something went wrong.", e );
                reject();
            }
        });
        return loadingComplete;
    }

    public getNextVersion(queryDir: string){
        // Get the next number in the experiments directory
        const versionsMade = fs.readdirSync( queryDir, { withFileTypes: true })
        .filter((item) => item.isDirectory())
        .map((item) => parseInt(item.name.replace(/^\D+/g, '')));

        if (versionsMade.length==0){
            return 1;
        }
        else{
            return Math.max(...versionsMade)+1;
        }
    }

    public addListener(bindingStream: BindingsStream, startTime: number, joinsMadeEpisode: string[], queryKey: string, 
        validation: boolean, recordExperience: boolean): Promise<number>{
        /**
         * Function that consumes the binding stream, measures elapsed time, and updates the batchTrainEpisode
         */
        const finishedReading: Promise<number> = new Promise((resolve, reject) => {
                bindingStream.on('data', (binding: any) => {
                });
                
                bindingStream.on('end', () => {
                    const endTime: number = this.getTimeSeconds();
                    const elapsed: number = endTime-startTime;
                    const statsY: IAggregateValues = this.runningMomentsExecutionTime.runningStats.get(this.runningMomentsExecutionTime.indexes[0])!;

                    if (!validation){
                        updateRunningMoments(statsY, elapsed);
                    }

                    const standardisedElapsed = (elapsed - statsY.mean) / statsY.std;
                    for (const joinMade of joinsMadeEpisode){
                        const trainingExample: ITrainingExample | undefined = validation ? this.batchedValidationExamples.trainingExamples.get(joinMade) :
                        this.batchedTrainingExamples.trainingExamples.get(joinMade);
                        if (!trainingExample){
                            throw new Error("Training example given that is not in batched episode");
                        }
                        const newExperience: IExperience = {actualExecutionTimeRaw: elapsed, actualExecutionTimeNorm: standardisedElapsed, 
                            joinIndexes: keyToIdx(joinMade), N:1};
                        if (recordExperience){
                            this.experienceBuffer.setExperience(queryKey, joinMade, newExperience, statsY);
                        }
                    }
                    resolve(elapsed);
                })    
        });
        return finishedReading;
    }

    public addListenerTimeOut(bindingStream: BindingsStream, startTime: number, joinsMadeEpisode: string[], queryKey: string, 
        validation: boolean, recordExperience: boolean): Promise<number>{
        /**
         * Function that consumes the binding stream, measures elapsed time, and updates the batchTrainEpisode
         */
        const timeLimit = 1000;
        let timeOutReached = false;
        let timeOutHandle: any;

        const timeOutPromise: Promise<number> = new Promise((resolve, reject)=>{
            timeOutHandle = setTimeout(
                () => {timeOutReached=true; resolve(timeLimit)},
                timeLimit
            );
        });

        const finishedReading: Promise<number> = new Promise((resolve, reject) => {
                bindingStream.on('data', (binding: any) => {
                    if (timeOutReached){
                        reject();
                    }
                });
                
                bindingStream.on('end', () => {
                    console.log("ARE WE RUNNING THIS?")
                    const endTime: number = this.getTimeSeconds();
                    const elapsed: number = endTime-startTime;
                    resolve(elapsed);
                })    
        });

        const resolvedPromise = Promise.race([timeOutPromise, finishedReading]).then(result => {
            clearTimeout(timeOutHandle);
            const elapsed = result;
            const statsY: IAggregateValues = this.runningMomentsExecutionTime.runningStats.get(this.runningMomentsExecutionTime.indexes[0])!;

            if (!validation){
                updateRunningMoments(statsY, elapsed);
            }

            const standardisedElapsed = (elapsed - statsY.mean) / statsY.std;
            for (const joinMade of joinsMadeEpisode){
                const trainingExample: ITrainingExample | undefined = validation ? this.batchedValidationExamples.trainingExamples.get(joinMade) :
                this.batchedTrainingExamples.trainingExamples.get(joinMade);
                if (!trainingExample){
                    throw new Error("Training example given that is not in batched episode");
                }
                const newExperience: IExperience = {actualExecutionTimeRaw: elapsed, actualExecutionTimeNorm: standardisedElapsed, 
                    joinIndexes: keyToIdx(joinMade), N:1};
                if (recordExperience){
                    this.experienceBuffer.setExperience(queryKey, joinMade, newExperience, statsY);
                }
            }
            console.log("Reached timeout!!");
            console.log(result);
            return 0;
        });
        return resolvedPromise;
    }

    public async awaitEngine(){
        this.engine = await this.engine
    }

    public getTimeSeconds(){
        const hrTime: number[] = process.hrtime();
        const time: number = hrTime[0] + hrTime[1] / 1000000000;
        return time
    }

    protected idxToKey(indexes: number[][]){
        return indexes.flat().toString().replaceAll(',', '');
    }
}

const trainEngine = new trainComunicaModel(1500);
const loadingTrain = trainEngine.loadWatDivQueries('missingGenreOutput/queries', false);
const loadingValidation = trainEngine.loadWatDivQueries('missingGenreOutput/queriesVal', true);
Error.stackTraceLimit = Infinity;

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
    try{
        const testStream: BindingsStream = await trainEngine.engine.query(cleanedQueries[0][0], {sources: ['http://localhost:3001/sparql'], train:true}, 'parsed');
    }
    catch(err){
        console.log(err)
    }
    // for (let i = 0; i<cleanedQueries.length; i++){
    //     for (let j = 0; j<cleanedQueries[i].length;j++){
    //         await trainEngine.engine.querySingleTrainStep(cleanedQueries[i][j], 
    //         {sources: ['missingGenreOutput/dataset.nt'],
    //         queryKey: `${i}`+`${j}`,
    //         train: true
    //         });
    //     }
    // }
});

