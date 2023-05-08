"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const path = require("path");
class ValidateModelCheckpoints {
    constructor() {
        const QueryEngine = require('@comunica/query-sparql-file').QueryEngineFactory;
        this.engine = new QueryEngine().create();
        this.batchedTrainingExamples = { trainingExamples: new Map, leafFeatures: { hiddenStates: [], memoryCell: [] } };
        this.batchedValidationExamples = { trainingExamples: new Map, leafFeatures: { hiddenStates: [], memoryCell: [] } };
        this.queries = [];
        this.valQueries = [];
        this.runningMomentsExecutionTime = { indexes: [0], runningStats: new Map() };
        for (const index of this.runningMomentsExecutionTime.indexes) {
            const startPoint = { N: 0, mean: 0, std: 1, M2: 1 };
            this.runningMomentsExecutionTime.runningStats.set(index, startPoint);
        }
    }
    async executeWarmUpQuery() {
        this.engine = await this.engine;
        const nopStream = await this.engine.query('SELECT * WHERE {?x ?y ?z} LIMIT 1', { "sources": ["output/dataset.nt"] });
    }
    async executeQueryValidation(query, sources) {
        const startTime = this.getTimeSeconds();
        // Execute and consume query
        const bindingsStream = await this.engine.queryBindings(query, { sources: sources });
        const exeuctionTimes = await this.addListener(bindingsStream, startTime);
        this.engine.disposeTrainEpisode();
        this.engine.trainEpisode = { joinsMade: [], estimatedQValues: [], featureTensor: { hiddenStates: [], memoryCell: [] }, isEmpty: true };
        return exeuctionTimes;
    }
    async loadWatDivQueries(queryDir, val) {
        const loadingComplete = new Promise(async (resolve, reject) => {
            try {
                // Get the files as an array
                const files = await fs.promises.readdir(queryDir);
                for (const file of files) {
                    // Get the full paths
                    const filePath = path.join(queryDir, file);
                    const data = fs.readFileSync(filePath, 'utf8');
                    if (val) {
                        this.valQueries.push(data);
                    }
                    else {
                        this.queries.push(data);
                    }
                }
                resolve(true);
            }
            catch (e) {
                console.error("Something went wrong.", e);
                reject();
            }
        });
        return loadingComplete;
    }
    addListener(bindingStream, startTime) {
        /**
         * Function that consumes the binding stream, measures elapsed time, and updates the batchTrainEpisode
         */
        let numEntriesPassed = 0;
        const finishedReading = new Promise((resolve, reject) => {
            bindingStream.on('data', (binding) => {
                numEntriesPassed += 1;
            });
            bindingStream.on('end', () => {
                const endTime = this.getTimeSeconds();
                const elapsed = endTime - startTime;
                const statsY = this.runningMomentsExecutionTime.runningStats.get(this.runningMomentsExecutionTime.indexes[0]);
                const standardisedElapsed = (elapsed - statsY.mean) / statsY.std;
                resolve([elapsed, standardisedElapsed]);
            });
        });
        return finishedReading;
    }
    async awaitEngine() {
        this.engine = await this.engine;
    }
    getTimeSeconds() {
        const hrTime = process.hrtime();
        const time = hrTime[0] + hrTime[1] / 1000000000;
        return time;
    }
    idxToKey(indexes) {
        return indexes.flat().toString().replaceAll(',', '');
    }
}
const numSimVal = 5;
const validatorEngine = new ValidateModelCheckpoints();
const loadingValidation = validatorEngine.loadWatDivQueries('output/queries', true);
// Find all chkpoints made during model training
const chkpointsFound = fs.readdirSync(path.join(__dirname, '../modelToValidate/'));
// Sort the directories
chkpointsFound.sort(function (a, b) {
    return a.localeCompare(b, undefined, {
        numeric: true,
        sensitivity: 'base'
    });
});
const chkpointsFoundAbsolute = chkpointsFound.map(x => path.join(__dirname, "../modelToValidate/", x));
const totalEpochTrainLoss = [];
const epochValLoss = [];
const epochValExecutionTime = [];
const epochValStdLoss = [];
console.log(`Number of validation query templates: ${validatorEngine.valQueries}`);
loadingValidation.then(async () => {
    let cleanedValidationQueries = validatorEngine.valQueries.map(x => x.replace(/\n/g, '').replace(/\t/g, '').split('SELECT'));
    await validatorEngine.executeWarmUpQuery();
    let i = 1;
    for (const chkpLocation of chkpointsFoundAbsolute) {
        console.log(`Checkpoint ${i}/${chkpointsFound.length + 1}`);
        await validatorEngine.engine.loadState(chkpLocation);
        const templateExecutionTimes = [];
        for (let i = 0; i < cleanedValidationQueries.length; i++) {
            console.log(`Query Template ${i + 1}/${cleanedValidationQueries.length}`);
            let totalExecutionTimeTemplate = 0;
            const querySubset = [...cleanedValidationQueries[i]];
            querySubset.shift();
            for (let j = 0; j < querySubset.length; j++) {
                let successfulJoinExecutions = 0;
                for (let k = 0; k < numSimVal; k++) {
                    const executionTimes = await validatorEngine.executeQueryValidation('SELECT' + querySubset[j], ["output/dataset.nt"]);
                    totalExecutionTimeTemplate += executionTimes[0];
                }
            }
            const averageTemplateExecutionTime = totalExecutionTimeTemplate / (querySubset.length * numSimVal);
            templateExecutionTimes.push(averageTemplateExecutionTime);
        }
        console.log("Average execution time per template");
        console.log(templateExecutionTimes);
        fs.appendFileSync("validationResults/averageExecutionTimeTemplate.txt", JSON.stringify(templateExecutionTimes) + "\n");
        i += 1;
    }
});
// loadingTrain.then(async ()=>{
//     let cleanedQueries: string[][] = validatorEngine.queries.map(x => x.replace(/\n/g, '').replace(/\t/g, '').split('SELECT'));
//     await validatorEngine.executeQueryTrain('SELECT' + cleanedQueries[1][1], ["output/dataset.nt"], false);
//     validatorEngine.cleanBatchTrainingExamples();
//     for (let epoch=0;epoch<nEpochs; epoch++){
//         let epochTrainLoss = [];
//         for (let i=0;i<cleanedQueries.length;i++){
//             console.log(`Query Template ${i+1}/${cleanedQueries.length}`);
//             const querySubset: string[] = [... cleanedQueries[i]];
//             querySubset.shift();
//             for (let j=0;j<querySubset.length;j++){
//                 let successfulJoinExecutions: number = 0;
//                 for (let k=0;k<numSim;k++){
//                     const foundJoins: boolean = await validatorEngine.executeQueryTrain('SELECT' + querySubset[j], ["output/dataset.nt"], true);
//                     // Here we keep track if there are joins in the executed query, if not we log the query and don't train on it
//                     // Does not work properly
//                     successfulJoinExecutions += foundJoins ? 1 : 0;
//                     if (!foundJoins){
//                         let mapEntry = zeroJoinsFound.get('SELECT' + querySubset[j]);
//                         if (mapEntry){
//                             mapEntry += 1;
//                         }
//                         else{
//                             zeroJoinsFound.set('SELECT' + querySubset[j], 1);
//                         }
//                     }
//                 }
//                 console.log(validatorEngine.batchedTrainingExamples);
//                 if (successfulJoinExecutions>0){
//                     epochTrainLoss.push(await validatorEngine.engine.trainModel(validatorEngine.batchedTrainingExamples));
//                 }
//                 validatorEngine.cleanBatchTrainingExamples();
//             }
//         }
//         const avgLossTrain = epochTrainLoss.reduce((a, b) => a + b, 0) / epochTrainLoss.length;
//         console.log(avgLossTrain);
//         const [avgExecution, avgExecutionTemplate, stdExecutionTemplate, avgLoss, stdLoss] = await validatePerformance(validatorEngine.valQueries);
//         console.log(`Epoch ${epoch+1}/${nEpochs}: Train Loss: ${avgLossTrain}, Validation Execution time: ${avgExecution}, Loss: ${avgLoss}, Std: ${stdLoss}`);
//         // Checkpointing
//         // const checkPointLocation = path.join(nextModelLocation + "/chkp-"+epoch);
//         // fs.mkdir(checkPointLocation, (err)=>{
//         //     if (err){
//         //         return console.error(err);
//         //     }
//         // });
//         // const epochStatisticsLocation = pathEpochInfos.map(x=>path.join(checkPointLocation, x));
//         // console.log(epochStatisticsLocation)
//         // totalEpochTrainLoss.push(avgLossTrain); epochValLoss.push(avgLoss); epochValExecutionTime.push(avgExecution); epochValStdLoss.push(stdLoss);    
//         // writeEpochFiles(epochStatisticsLocation, [totalEpochTrainLoss, epochValLoss, epochValStdLoss, epochValExecutionTime], epoch);
//     }
//     fs.writeFileSync('log/skippedQueries.json', JSON.stringify([...zeroJoinsFound]) , 'utf-8'); 
//     validatorEngine.engine.saveModel(pathRunningMoments+"runningMomentsFeatures"+1+".json");  
// });
//# sourceMappingURL=validate_chkpoints.js.map