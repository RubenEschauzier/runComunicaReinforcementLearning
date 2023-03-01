import {BindingsStream, IBatchedTrainingExamples, ITrainEpisode, ITrainingExample} from "@comunica/types";
import {IAggregateValues, IRunningMoments} from "@comunica/mediator-join-reinforcement-learning";
import * as fs from 'fs';
import * as path from 'path';
import { updateRunningMoments } from "./helper";


class trainComunicaModel{
    public engine: any;
    public queries: string[];
    public valQueries:string[];
    public batchedTrainingExamples: IBatchedTrainingExamples;
    public batchedValidationExamples: IBatchedTrainingExamples;
    public runningMomentsExecutionTime: IRunningMoments;

    public constructor(){
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
    }

    public async executeQueryTrain(query: string, sources:string[], train:boolean, runningMomentsFeatureFile?: string){
        this.engine = await this.engine;
        const starthrTime: number[] = process.hrtime();
        const startTime: number = starthrTime[0] + starthrTime[1] / 1000000000;
        const bindingsStream: BindingsStream = await this.engine.queryBindings(query, {sources: sources, batchedTrainingExamples: this.batchedTrainingExamples,
        runningMomentsFeatureFile: runningMomentsFeatureFile, train: train});

        let foundJoins = true;
        if (train){
            if (this.engine.trainEpisode.joinsMade.length==0){
                foundJoins = false;
                // throw new Error("Training episode contained 0 joins");
            }
            const joinOrderKeys: string[] = [];
            // Get joins made in this query to update
            for (let i = 1; i <this.engine.trainEpisode.joinsMade.length+1;i++){
                const joinIndexId = this.engine.trainEpisode.joinsMade.slice(0, i);
                joinOrderKeys.push(this.idxToKey(joinIndexId));
            }
            await this.addListener(bindingsStream, startTime, joinOrderKeys, false);
            // Clear episode tensors
            this.engine.disposeTrainEpisode();
            this.engine.trainEpisode = {joinsMade: [], estimatedQValues: [], featureTensor: {hiddenStates:[], memoryCell:[]}, isEmpty:true};    
        }
        return foundJoins
    }

    public async executeQueryValidation(query: string, sources:string[]){
        const startTime: number = this.getTimeSeconds();
        const bindingsStream: BindingsStream = await this.engine.queryBindings(query, {sources: sources, batchedTrainingExamples: this.batchedValidationExamples, train: true});
        const joinOrderKeys: string[] = [];
        for (let i = 1; i <this.engine.trainEpisode.joinsMade.length+1;i++){
            const joinIndexId = this.engine.trainEpisode.joinsMade.slice(0, i);
            joinOrderKeys.push(this.idxToKey(joinIndexId));
        }    
        const exeuctionTimeRaw: number = await this.addListener(bindingsStream, startTime, joinOrderKeys, true);
        this.engine.disposeTrainEpisode();
        this.engine.trainEpisode = {joinsMade: [], estimatedQValues: [], featureTensor: {hiddenStates:[], memoryCell:[]}, isEmpty:true};    
        return exeuctionTimeRaw;
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

    public addListener(bindingStream: BindingsStream, startTime: number, joinsMadeEpisode: string[], val: boolean): Promise<number>{
        /**
         * Function that consumes the binding stream, measures elapsed time, and updates the batchTrainEpisode
         */
        let numEntriesPassed: number = 0;
        const finishedReading: Promise<number> = new Promise((resolve, reject) => {
                bindingStream.on('data', (binding: any) => {
                    numEntriesPassed += 1;
                });
                
                bindingStream.on('end', () => {
                    const endTime: number = this.getTimeSeconds();
                    const elapsed: number = endTime-startTime;
                    const statsY: IAggregateValues = this.runningMomentsExecutionTime.runningStats.get(this.runningMomentsExecutionTime.indexes[0])!;

                    if (!val){
                        updateRunningMoments(statsY, elapsed);
                    }

                    const standardisedElapsed = (elapsed - statsY.mean) / statsY.std;
                    for (const joinMade of joinsMadeEpisode){
                        const trainingExample: ITrainingExample | undefined = val ? this.batchedValidationExamples.trainingExamples.get(joinMade) :
                        this.batchedTrainingExamples.trainingExamples.get(joinMade);
                        if (!trainingExample){
                            throw new Error("Training example given that is not in batched episode");
                        }
                        if(trainingExample.actualExecutionTime == -1){
                            trainingExample.actualExecutionTime = standardisedElapsed;
                        }
                        else{
                            trainingExample.actualExecutionTime = trainingExample.actualExecutionTime + 
                            ((standardisedElapsed - trainingExample.actualExecutionTime)/(trainingExample.N+1));           
                        }
                        trainingExample.N += 1;
                    }
                    resolve(elapsed);
                })    
        });
        return finishedReading;
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

const numSim = 2;
const numSimVal = 2;
const nEpochs = 10;
const pathRunningMoments = "../../actor-rdf-join-inner-multi-reinforcement-learning-tree/model/moments/";
const pathEpochInfos: string[] = ["avgTrainLoss.txt", "avgValLoss.txt","stdValLoss.txt", "avgValExecutionTime.txt"];

const zeroJoinsFound = new Map<string, number>();

const trainEngine = new trainComunicaModel();
const nextModelVersion = trainEngine.getNextVersion(path.join(__dirname, '../log'));
const nextModelLocation = path.join(__dirname, "../log/model-version-"+nextModelVersion);
console.log(nextModelLocation)
const loadingTrain = trainEngine.loadWatDivQueries('output/queries', false);
const loadingValidation = trainEngine.loadWatDivQueries('missingGenreOutput/queriesVal', true);

const totalEpochTrainLoss: number[] = [];
const epochValLoss: number[] = [];
const epochValExecutionTime: number[] = [];
const epochValStdLoss: number[] = []

fs.mkdir(nextModelLocation, (err)=>{
    if (err){
        return console.error(err);
    }
});

loadingTrain.then(async ()=>{
    let cleanedQueries: string[][] = trainEngine.queries.map(x => x.replace(/\n/g, '').replace(/\t/g, '').split('SELECT'));
    await trainEngine.executeQueryTrain('SELECT' + cleanedQueries[1][1], ["output/dataset.nt"], false);
    trainEngine.cleanBatchTrainingExamples();

    for (let epoch=0;epoch<nEpochs; epoch++){
        let epochTrainLoss = [];
        for (let i=0;i<cleanedQueries.length;i++){
            console.log(`Query Template ${i+1}/${cleanedQueries.length}`);

            const querySubset: string[] = [... cleanedQueries[i]];
            querySubset.shift();

            for (let j=0;j<querySubset.length;j++){

                let successfulJoinExecutions: number = 0;
                for (let k=0;k<numSim;k++){
                    const foundJoins: boolean = await trainEngine.executeQueryTrain('SELECT' + querySubset[j], ["output/dataset.nt"], true);
                    // Here we keep track if there are joins in the executed query, if not we log the query and don't train on it
                    // Does not work properly
                    successfulJoinExecutions += foundJoins ? 1 : 0;
                    if (!foundJoins){
                        let mapEntry = zeroJoinsFound.get('SELECT' + querySubset[j]);
                        if (mapEntry){
                            mapEntry += 1;
                        }
                        else{
                            zeroJoinsFound.set('SELECT' + querySubset[j], 1);
                        }
                    }
                }
                console.log(trainEngine.batchedTrainingExamples);
                if (successfulJoinExecutions>0){
                    epochTrainLoss.push(await trainEngine.engine.trainModel(trainEngine.batchedTrainingExamples));
                }
                trainEngine.cleanBatchTrainingExamples();
            }
        }
        const avgLossTrain = epochTrainLoss.reduce((a, b) => a + b, 0) / epochTrainLoss.length;
        console.log(avgLossTrain);
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
    }
    fs.writeFileSync('log/skippedQueries.json', JSON.stringify([...zeroJoinsFound]) , 'utf-8'); 
    trainEngine.engine.saveModel(pathRunningMoments+"runningMomentsFeatures"+1+".json");  
});

async function validatePerformance(queries: string[]):Promise<[number, number[], number[], number, number]>{
    console.log("Running validation");
    await loadingValidation;
    let cleanedQueries: string[][] = trainEngine.valQueries.map(x => x.replace(/\n/g, '').replace(/\t/g, '').split('SELECT'));
    const rawExecutionTimesTemplate: number[][] = [];
    for(let i=0;i<cleanedQueries.length;i++){
        const rawExecutionTimes: number[] = []
        const querySubset: string[] = [... cleanedQueries[i]];
        // Start at j=1 because first element is empty
        for (let j=1;j<querySubset.length;j++){
            // Because complex queries are all the same, we have only one per template, we skew training execution to small time elapsed, 
            // should prob do something about that? Like add back the complex queries??
            for (let k=0;k<numSimVal;k++){
                const executionTimeRaw: number = await trainEngine.executeQueryValidation('SELECT' + querySubset[j], ["missingGenreOutput/dataset.nt"]);
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
    return [avgExecutionTime, avgExecutionTimeTemplate, stdExecutionTimeTemplate, averageLoss, stdLoss];
}

function stdArray(values: number[], mean: number){
    const std: number = Math.sqrt((values.map(x=>(x-mean)**2).reduce((a, b)=>a+b,0) / values.length));
    return std
}

function writeEpochFiles(fileLocations: string[], epochInformation: number[][], epochNum: number){
    for (let i=0;i<fileLocations.length;i++){
        fs.writeFileSync(fileLocations[i], JSON.stringify([...epochInformation[i]]));
    }
    fs.writeFileSync('log/skippedQueries.json', JSON.stringify([...zeroJoinsFound]) , 'utf-8'); 
}