import {BindingsStream, IBatchedTrainingExamples, ITrainEpisode, ITrainingExample} from "@comunica/types";
import {IAggregateValues, IResultSetRepresentation, IRunningMoments} from "@comunica/mediator-join-reinforcement-learning";
import * as fs from 'fs';
import * as path from 'path';
import * as tf from '@tensorflow/tfjs-node'
import { ExperienceBuffer, IExperience, IExperienceKey, keyToIdx, updateRunningMoments } from "./helper";


// MUST READ: https://lwn.net/Articles/250967/

class trainComunicaModel{
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
// Magic numbers
const numSim = 1;
const numSimVal = 5;
const numExperiencePerSim = 8;
const nEpochs = 40;
const sizeBuffer = 2000;

// Timeouts set according to execution time of multi-smallest actor in standard comunica
const timeouts: number[] = [1,1,1,1,1,1,1,30,1,1,1,1,1,1,1,1,1,1];

// Actual engine used for training
const trainEngine = new trainComunicaModel(sizeBuffer);

// Logging info
const pathRunningMoments = "../../actor-rdf-join-inner-multi-reinforcement-learning-tree/model/moments/";
const pathEpochInfos: string[] = ["avgTrainLoss.txt", "avgValLoss.txt","stdValLoss.txt", "avgValExecutionTime.txt"];
const nextModelVersion = trainEngine.getNextVersion(path.join(__dirname, '../log'));
const nextModelLocation = path.join(__dirname, "../log/model-version-exp-replay-"+nextModelVersion);

// Loading queries
const loadingTrain = trainEngine.loadWatDivQueries('missingGenreOutput/queries', false);
const loadingValidation = trainEngine.loadWatDivQueries('missingGenreOutput/queriesVal', true);

// Tracking statistics
const totalEpochTrainLoss: number[] = [];
const epochValLoss: number[] = [];
const epochValExecutionTime: number[] = [];
const epochValStdLoss: number[] = [];
const averageSearchTime: number[] = [];

fs.mkdir(nextModelLocation, (err)=>{
    if (err){
        return console.error(err);
    }
});
// FOR DEBUGGING
Error.stackTraceLimit = Infinity;

loadingTrain.then(async ()=>{
    let cleanedQueries: string[][] = trainEngine.queries.map(x => x.replace(/\n/g, '').replace(/\t/g, '').split('SELECT'));
    await trainEngine.awaitEngine();
    // await trainEngine.executeQueryTrain('SELECT' + cleanedQueries[1][1], ["output/dataset.nt"], false);
    await initialiseFeaturesExperienceBuffer(trainEngine.experienceBuffer, cleanedQueries);
    for (let epoch=0;epoch<nEpochs; epoch++){
        let epochTrainLoss = [];
        for (let i=0;i<cleanedQueries.length;i++){
            const querySubset: string[] = [... cleanedQueries[i]];
            querySubset.shift();

            console.log(`Query Template ${i+1}/${cleanedQueries.length}`);

            const searchTimes = [];
            for (let j=0;j<querySubset.length;j++){

                const queryKey: string = `${i}`+`${j}`;
                for (let k=0;k<numSim;k++){
                    const searchTime = await trainEngine.executeQueryTrain('SELECT' + querySubset[j], ["missingGenreOutput/dataset.nt"], true, queryKey);
                    searchTimes.push(searchTime);
                    const experiences: IExperience[] = [];
                    const features = [];                    
                    // Sample experiences from the buffer if we have enough prior executions
                    if (trainEngine.experienceBuffer.getSize()>1){
                        for (let z=0;z<numExperiencePerSim;z++){
                            const experience: [IExperience, IExperienceKey] = trainEngine.experienceBuffer.getRandomExperience();
                            experiences.push(experience[0]);
                            const feature = trainEngine.experienceBuffer.getFeatures(experience[1].query)!;
                            features.push(feature);
                        }
                        const loss = await trainEngine.engine.trainModelExperienceReplay(experiences, features);
                        epochTrainLoss.push(loss);
                    }
                }
                trainEngine.cleanBatchTrainingExamples();
            }
            averageSearchTime.push(searchTimes.reduce((a, b) => a + b, 0) / searchTimes.length);
        }
        console.log(averageSearchTime);
        const avgLossTrain = epochTrainLoss.reduce((a, b) => a + b, 0) / epochTrainLoss.length;
        const [avgExecution, avgExecutionTemplate, stdExecutionTemplate, avgLoss, stdLoss] = await validatePerformance(trainEngine.valQueries);
        console.log(`Epoch ${epoch+1}/${nEpochs}: Train Loss: ${avgLossTrain}, Validation Execution time: ${avgExecution}, Loss: ${avgLoss}, Std: ${stdLoss}`);

        // Checkpointing
        const checkPointLocation = path.join(nextModelLocation + "/chkp-"+epoch);

        fs.mkdir(checkPointLocation, (err)=>{
            if (err){
                return console.error(err);
            }
        });

        const epochStatisticsLocation = pathEpochInfos.map(x=>path.join(checkPointLocation, x));
        console.log(epochStatisticsLocation)

        totalEpochTrainLoss.push(avgLossTrain); epochValLoss.push(avgLoss); epochValExecutionTime.push(avgExecution); epochValStdLoss.push(stdLoss);    
        writeEpochFiles(epochStatisticsLocation, [totalEpochTrainLoss, epochValLoss, epochValStdLoss, epochValExecutionTime], epoch);
        trainEngine.engine.saveModel();
    }
    trainEngine.engine.saveModel(pathRunningMoments+"runningMomentsFeatures"+1+".json");  
});

async function validatePerformance(queries: string[]):Promise<[number, number[], number[], number, number]>{
    console.log("Running validation");
    console.log(`Start tensors ${tf.memory().numTensors}`);
    await loadingValidation;
    let cleanedQueries: string[][] = trainEngine.valQueries.map(x => x.replace(/\n/g, '').replace(/\t/g, '').split('SELECT'));
    const rawExecutionTimesTemplate: number[][] = [];
    for(let i=0;i<cleanedQueries.length;i++){
        const rawExecutionTimes: number[] = []
        const querySubset: string[] = [... cleanedQueries[i]];
        querySubset.shift();
        // Start at j=1 because first element is empty
        for (let j=0;j<querySubset.length;j++){
            const queryKey: string = `${i}`+`${j}`;
            // Because complex queries are all the same, we have only one per template, we skew training execution to small time elapsed, 
            // should prob do something about that? Like add back the complex queries??
            for (let k=0;k<numSimVal;k++){
                const executionTimeRaw: number = await trainEngine.executeQueryValidation('SELECT' + querySubset[j], ["missingGenreOutput/dataset.nt"], queryKey);
                rawExecutionTimes.push(executionTimeRaw);
            }
        }

        rawExecutionTimesTemplate.push(rawExecutionTimes);
    }
    // Get raw validaiton execution time statistics
    const flatExeTime: number[] = rawExecutionTimesTemplate.flat();
    const avgExecutionTime = flatExeTime.reduce((a, b) => a + b, 0) / flatExeTime.length;
    const avgExecutionTimeTemplate = rawExecutionTimesTemplate.map(x=>(x.reduce((a,b)=> a+b,0))/x.length);
    const stdExecutionTimeTemplate = [];

    for (let k=0;k<avgExecutionTimeTemplate.length;k++){
        stdExecutionTimeTemplate.push(stdArray(rawExecutionTimesTemplate[k],avgExecutionTimeTemplate[k]))
    }
    // Get validation loss
    const MSE: number[] = [];
    for (const [_, trainExample] of trainEngine.batchedValidationExamples.trainingExamples.entries()){
        const singleMSE = (trainExample.qValue - trainExample.actualExecutionTime)**2;
        MSE.push(singleMSE);
    }
    const averageLoss = MSE.reduce((a,b)=> a+b,0)/MSE.length;
    const stdLoss = stdArray(MSE, averageLoss);

    // Clean batch after validation
    trainEngine.cleanBatchTrainingExamplesValidation();
    console.log(`End tensors ${tf.memory().numTensors}`);
    return [avgExecutionTime, avgExecutionTimeTemplate, stdExecutionTimeTemplate, averageLoss, stdLoss];
}

async function initialiseFeaturesExperienceBuffer(buffer: ExperienceBuffer, queries: string[][]){

    for(let i=0;i<queries.length;i++){
        const rawExecutionTimes: number[] = []
        const querySubset: string[] = [... queries[i]];
        querySubset.shift();
        // Start at j=1 because first element is empty
        for (let j=0;j<querySubset.length;j++){
            const queryKey: string = `${i}`+`${j}`;
            const features: IResultSetRepresentation = await trainEngine.executeQueryInitFeaturesBuffer('SELECT' + querySubset[j], 
            ["missingGenreOutput/dataset.nt"]);
            buffer.setLeafFeaturesQuery(queryKey, features);
        }
    }

    return
}
function stdArray(values: number[], mean: number){
    const std: number = Math.sqrt((values.map(x=>(x-mean)**2).reduce((a, b)=>a+b,0) / values.length));
    return std
}

function writeEpochFiles(fileLocations: string[], epochInformation: number[][], epochNum: number){
    for (let i=0;i<fileLocations.length;i++){
        fs.writeFileSync(fileLocations[i], JSON.stringify([...epochInformation[i]]));
    }
    // fs.writeFileSync('log/skippedQueries.json', JSON.stringify([...zeroJoinsFound]) , 'utf-8'); 
}

