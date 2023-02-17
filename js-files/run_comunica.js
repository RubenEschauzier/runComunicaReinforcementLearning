"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const path = require("path");
const update_moments_1 = require("./update_moments");
// TEST
var readline = require('readline');
class trainComunicaModel {
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
    async executeQueryTrain(query, sources, train, runningMomentsFeatureFile) {
        this.engine = await this.engine;
        const starthrTime = process.hrtime();
        const startTime = starthrTime[0] + starthrTime[1] / 1000000000;
        const bindingsStream = await this.engine.queryBindings(query, { sources: sources, batchedTrainingExamples: this.batchedTrainingExamples,
            runningMomentsFeatureFile: runningMomentsFeatureFile, train: train });
        let foundJoins = true;
        if (train) {
            if (this.engine.trainEpisode.joinsMade.length == 0) {
                foundJoins = false;
                // throw new Error("Training episode contained 0 joins");
            }
            const joinOrderKeys = [];
            // Get joins made in this query to update
            for (let i = 1; i < this.engine.trainEpisode.joinsMade.length + 1; i++) {
                const joinIndexId = this.engine.trainEpisode.joinsMade.slice(0, i);
                joinOrderKeys.push(this.idxToKey(joinIndexId));
            }
            await this.addListener(bindingsStream, startTime, joinOrderKeys, false);
            // Clear episode tensors
            this.engine.disposeTrainEpisode();
            this.engine.trainEpisode = { joinsMade: [], estimatedQValues: [], featureTensor: { hiddenStates: [], memoryCell: [] }, isEmpty: true };
        }
        return foundJoins;
    }
    async executeQueryValidation(query, sources) {
        const startTime = this.getTimeSeconds();
        const bindingsStream = await this.engine.queryBindings(query, { sources: sources, batchedTrainingExamples: this.batchedValidationExamples, train: true });
        const joinOrderKeys = [];
        for (let i = 1; i < this.engine.trainEpisode.joinsMade.length + 1; i++) {
            const joinIndexId = this.engine.trainEpisode.joinsMade.slice(0, i);
            joinOrderKeys.push(this.idxToKey(joinIndexId));
        }
        const exeuctionTimeRaw = await this.addListener(bindingsStream, startTime, joinOrderKeys, true);
        this.engine.disposeTrainEpisode();
        this.engine.trainEpisode = { joinsMade: [], estimatedQValues: [], featureTensor: { hiddenStates: [], memoryCell: [] }, isEmpty: true };
        return exeuctionTimeRaw;
    }
    cleanBatchTrainingExamples() {
        this.batchedTrainingExamples.leafFeatures.hiddenStates.map(x => x.dispose());
        this.batchedTrainingExamples.leafFeatures.memoryCell.map(x => x.dispose());
        this.batchedTrainingExamples = { trainingExamples: new Map, leafFeatures: { hiddenStates: [], memoryCell: [] } };
    }
    cleanBatchTrainingExamplesValidation() {
        this.batchedValidationExamples.leafFeatures.hiddenStates.map(x => x.dispose());
        this.batchedValidationExamples.leafFeatures.memoryCell.map(x => x.dispose());
        this.batchedValidationExamples = { trainingExamples: new Map, leafFeatures: { hiddenStates: [], memoryCell: [] } };
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
    addListener(bindingStream, startTime, joinsMadeEpisode, val) {
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
                if (!val) {
                    (0, update_moments_1.updateRunningMoments)(statsY, elapsed);
                }
                const standardisedElapsed = (elapsed - statsY.mean) / statsY.std;
                for (const joinMade of joinsMadeEpisode) {
                    const trainingExample = val ? this.batchedValidationExamples.trainingExamples.get(joinMade) :
                        this.batchedTrainingExamples.trainingExamples.get(joinMade);
                    if (!trainingExample) {
                        throw new Error("Training example given that is not in batched episode");
                    }
                    if (trainingExample.actualExecutionTime == -1) {
                        trainingExample.actualExecutionTime = standardisedElapsed;
                    }
                    else {
                        trainingExample.actualExecutionTime = trainingExample.actualExecutionTime +
                            ((standardisedElapsed - trainingExample.actualExecutionTime) / (trainingExample.N + 1));
                    }
                    trainingExample.N += 1;
                }
                resolve(elapsed);
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
const numSim = 5;
const numSimVal = 10;
const nEpochs = 5;
const pathRunningMoments = "../../actor-rdf-join-inner-multi-reinforcement-learning-tree/model/moments/";
const pathEpochInfos = [path.join(__dirname, "../log/avgTrainLoss"),
    path.join(__dirname, "../log/avgValLoss"),
    path.join(__dirname, "../log/stdValLoss"),
    path.join(__dirname, "../log/avgValExecutionTime")];
const zeroJoinsFound = new Map();
const trainEngine = new trainComunicaModel();
const loadingTrain = trainEngine.loadWatDivQueries('output/queries', false);
const loadingValidation = trainEngine.loadWatDivQueries('missingGenreOutput/queriesVal', true);
const totalEpochTrainLoss = [];
const epochValLoss = [];
const epochValExecutionTime = [];
const epochValStdLoss = [];
loadingTrain.then(async () => {
    let cleanedQueries = trainEngine.queries.map(x => x.replace(/\n/g, '').replace(/\t/g, '').split('SELECT'));
    await trainEngine.executeQueryTrain('SELECT' + cleanedQueries[1][1], ["output/dataset.nt"], false);
    trainEngine.cleanBatchTrainingExamples();
    for (let epoch = 0; epoch < nEpochs; epoch++) {
        let epochTrainLoss = [];
        for (let i = 3; i < cleanedQueries.length; i++) {
            console.log(`Query Template ${i + 1}/${cleanedQueries.length}`);
            const querySubset = [...cleanedQueries[i]];
            querySubset.shift();
            for (let j = 0; j < querySubset.length; j++) {
                let successfulJoinExecutions = 0;
                for (let k = 0; k < numSim; k++) {
                    const foundJoins = await trainEngine.executeQueryTrain('SELECT' + querySubset[j], ["output/dataset.nt"], true);
                    // Here we keep track if there are joins in the executed query, if not we log the query and don't train on it
                    successfulJoinExecutions += foundJoins ? 1 : 0;
                    if (!foundJoins) {
                        let mapEntry = zeroJoinsFound.get('SELECT' + querySubset[j]);
                        if (mapEntry) {
                            mapEntry += 1;
                        }
                        else {
                            zeroJoinsFound.set('SELECT' + querySubset[j], 1);
                        }
                    }
                }
                if (successfulJoinExecutions > 0) {
                    epochTrainLoss.push(await trainEngine.engine.trainModel(trainEngine.batchedTrainingExamples));
                }
                trainEngine.cleanBatchTrainingExamples();
            }
        }
        const avgLossTrain = epochTrainLoss.reduce((a, b) => a + b, 0) / epochTrainLoss.length;
        const [avgExecution, avgExecutionTemplate, stdExecutionTemplate, avgLoss, stdLoss] = await validatePerformance(trainEngine.valQueries);
        console.log(`Epoch ${epoch + 1}/${nEpochs}: Train Loss: ${avgLossTrain}, Validation Execution time: ${avgExecution}, Loss: ${avgLoss}, Std: ${stdLoss}`);
        totalEpochTrainLoss.push(avgLossTrain);
        epochValLoss.push(avgLoss);
        epochValExecutionTime.push(avgExecution);
        epochValStdLoss.push(stdLoss);
        writeEpochFiles(pathEpochInfos, [epochTrainLoss, epochValLoss, epochValStdLoss, epochValExecutionTime], epoch);
    }
    fs.writeFileSync('log/skippedQueries.json', JSON.stringify([...zeroJoinsFound]), 'utf-8');
    trainEngine.engine.saveModel(pathRunningMoments + "runningMomentsFeatures" + 1 + ".json");
});
async function validatePerformance(queries) {
    await loadingValidation;
    let cleanedQueries = trainEngine.valQueries.map(x => x.replace(/\n/g, '').replace(/\t/g, '').split('SELECT'));
    const rawExecutionTimesTemplate = [];
    for (let i = 3; i < cleanedQueries.length; i++) {
        const rawExecutionTimes = [];
        const querySubset = [...cleanedQueries[i]];
        // Start at j=1 because first element is empty
        for (let j = 1; j < querySubset.length; j++) {
            // Because complex queries are all the same, we have only one per template, we skew training execution to small time elapsed, 
            // should prob do something about that? Like add back the complex queries??
            for (let k = 0; k < numSimVal; k++) {
                const executionTimeRaw = await trainEngine.executeQueryValidation('SELECT' + querySubset[j], ["missingGenreOutput/dataset.nt"]);
                rawExecutionTimes.push(executionTimeRaw);
            }
        }
        rawExecutionTimesTemplate.push(rawExecutionTimes);
    }
    // Get raw validaiton execution time statistics
    const flatExeTime = rawExecutionTimesTemplate.flat();
    const avgExecutionTime = flatExeTime.reduce((a, b) => a + b, 0) / flatExeTime.length;
    const avgExecutionTimeTemplate = rawExecutionTimesTemplate.map(x => (x.reduce((a, b) => a + b, 0)) / x.length);
    const stdExecutionTimeTemplate = [];
    for (let k = 0; k < avgExecutionTimeTemplate.length; k++) {
        stdExecutionTimeTemplate.push(stdArray(rawExecutionTimesTemplate[k], avgExecutionTimeTemplate[k]));
    }
    // Get validation loss
    const MSE = [];
    for (const [_, trainExample] of trainEngine.batchedValidationExamples.trainingExamples.entries()) {
        const singleMSE = (trainExample.qValue - trainExample.actualExecutionTime) ** 2;
        MSE.push(singleMSE);
    }
    const averageLoss = MSE.reduce((a, b) => a + b, 0) / MSE.length;
    const stdLoss = stdArray(MSE, averageLoss);
    // Clean batch after validation
    trainEngine.cleanBatchTrainingExamplesValidation();
    return [avgExecutionTime, avgExecutionTimeTemplate, stdExecutionTimeTemplate, averageLoss, stdLoss];
}
function stdArray(values, mean) {
    const std = Math.sqrt((values.map(x => (x - mean) ** 2).reduce((a, b) => a + b, 0) / values.length));
    return std;
}
function writeEpochFiles(fileLocations, epochInformation, epochNum) {
    for (let i = 0; i < fileLocations.length; i++) {
        fs.writeFileSync(fileLocations[i] + epochNum + ".json", JSON.stringify([...epochInformation[i]]));
    }
    fs.writeFileSync('log/skippedQueries.json', JSON.stringify([...zeroJoinsFound]), 'utf-8');
}
//# sourceMappingURL=run_comunica.js.map