"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const path = require("path");
const tf = require("@tensorflow/tfjs-node");
const helper_1 = require("./helper");
// MUST READ: https://lwn.net/Articles/250967/
class trainComunicaModel {
    constructor(bufferSize) {
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
        this.experienceBuffer = new helper_1.ExperienceBuffer(bufferSize, this.queries.length);
    }
    async executeQueryTrain(query, sources, train, queryKey, runningMomentsFeatureFile) {
        const startTime = this.getTimeSeconds();
        const bindingsStream = await this.engine.queryBindings(query, { sources: sources, batchedTrainingExamples: this.batchedTrainingExamples,
            runningMomentsFeatureFile: runningMomentsFeatureFile, train: train });
        const endTimeSearch = this.getTimeSeconds();
        if (train) {
            if (this.engine.trainEpisode.joinsMade.length == 0) {
                this.engine.disposeTrainEpisode();
                this.engine.trainEpisode = { joinsMade: [], estimatedQValues: [], featureTensor: { hiddenStates: [], memoryCell: [] }, isEmpty: true };
                return endTimeSearch - startTime;
                // throw new Error("Training episode contained 0 joins");
            }
            const joinOrderKeys = [];
            // Get joins made in this query to update
            for (let i = 1; i < this.engine.trainEpisode.joinsMade.length + 1; i++) {
                const joinIndexId = this.engine.trainEpisode.joinsMade.slice(0, i);
                joinOrderKeys.push(this.idxToKey(joinIndexId));
            }
            await this.addListener(bindingsStream, startTime, joinOrderKeys, queryKey, false, true);
            // Clear episode tensors
            this.engine.disposeTrainEpisode();
            this.engine.trainEpisode = { joinsMade: [], estimatedQValues: [], featureTensor: { hiddenStates: [], memoryCell: [] }, isEmpty: true };
        }
        return endTimeSearch - startTime;
    }
    async executeQueryValidation(query, sources, queryKey) {
        const startTime = this.getTimeSeconds();
        const bindingsStream = await this.engine.queryBindings(query, { sources: sources,
            batchedTrainingExamples: this.batchedValidationExamples, train: true });
        const joinOrderKeys = [];
        for (let i = 1; i < this.engine.trainEpisode.joinsMade.length + 1; i++) {
            const joinIndexId = this.engine.trainEpisode.joinsMade.slice(0, i);
            joinOrderKeys.push(this.idxToKey(joinIndexId));
        }
        const exeuctionTimeRaw = await this.addListener(bindingsStream, startTime, joinOrderKeys, queryKey, true, false);
        this.engine.disposeTrainEpisode();
        this.engine.trainEpisode = { joinsMade: [], estimatedQValues: [], featureTensor: { hiddenStates: [], memoryCell: [] }, isEmpty: true };
        return exeuctionTimeRaw;
    }
    async executeQueryInitFeaturesBuffer(query, sources) {
        const startTime = this.getTimeSeconds();
        const bindingsStream = await this.engine.queryBindings(query, { sources: sources,
            batchedTrainingExamples: this.batchedValidationExamples, train: true });
        const leafFeatures = { hiddenStates: this.batchedValidationExamples.leafFeatures.hiddenStates.map(x => x.clone()),
            memoryCell: this.batchedValidationExamples.leafFeatures.memoryCell.map(x => x.clone()) };
        this.engine.disposeTrainEpisode();
        this.engine.trainEpisode = { joinsMade: [], estimatedQValues: [], featureTensor: { hiddenStates: [], memoryCell: [] }, isEmpty: true };
        this.cleanBatchTrainingExamplesValidation();
        return leafFeatures;
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
    getNextVersion(queryDir) {
        // Get the next number in the experiments directory
        const versionsMade = fs.readdirSync(queryDir, { withFileTypes: true })
            .filter((item) => item.isDirectory())
            .map((item) => parseInt(item.name.replace(/^\D+/g, '')));
        if (versionsMade.length == 0) {
            return 1;
        }
        else {
            return Math.max(...versionsMade) + 1;
        }
    }
    addListener(bindingStream, startTime, joinsMadeEpisode, queryKey, validation, recordExperience) {
        /**
         * Function that consumes the binding stream, measures elapsed time, and updates the batchTrainEpisode
         */
        const timeLimit = 1000;
        let timeOutReached = false;
        let timeOutHandle;
        const timeOutPromise = new Promise((resolve, reject) => {
            timeOutHandle = setTimeout(() => { timeOutReached = true; resolve(timeLimit); }, timeLimit);
        });
        const finishedReading = new Promise((resolve, reject) => {
            bindingStream.on('data', (binding) => {
                if (timeOutReached) {
                    reject();
                }
            });
            bindingStream.on('end', () => {
                console.log("ARE WE RUNNING THIS?");
                const endTime = this.getTimeSeconds();
                const elapsed = endTime - startTime;
                resolve(elapsed);
            });
        });
        const resolvedPromise = Promise.race([timeOutPromise, finishedReading]).then(result => {
            clearTimeout(timeOutHandle);
            const elapsed = result;
            const statsY = this.runningMomentsExecutionTime.runningStats.get(this.runningMomentsExecutionTime.indexes[0]);
            if (!validation) {
                (0, helper_1.updateRunningMoments)(statsY, elapsed);
            }
            const standardisedElapsed = (elapsed - statsY.mean) / statsY.std;
            for (const joinMade of joinsMadeEpisode) {
                const trainingExample = validation ? this.batchedValidationExamples.trainingExamples.get(joinMade) :
                    this.batchedTrainingExamples.trainingExamples.get(joinMade);
                if (!trainingExample) {
                    throw new Error("Training example given that is not in batched episode");
                }
                const newExperience = { actualExecutionTimeRaw: elapsed, actualExecutionTimeNorm: standardisedElapsed,
                    joinIndexes: (0, helper_1.keyToIdx)(joinMade), N: 1 };
                if (recordExperience) {
                    this.experienceBuffer.setExperience(queryKey, joinMade, newExperience, statsY);
                }
            }
            console.log("Reached timeout!!");
            console.log(result);
            return 0;
        });
        return resolvedPromise;
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
// Magic numbers
const numSim = 1;
const numSimVal = 5;
const numExperiencePerSim = 8;
const nEpochs = 40;
const sizeBuffer = 2000;
// Timeouts set according to execution time of multi-smallest actor in standard comunica
const timeouts = [1, 1, 1, 1, 1, 1, 1, 30, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
// Actual engine used for training
const trainEngine = new trainComunicaModel(sizeBuffer);
// Logging info
const pathRunningMoments = "../../actor-rdf-join-inner-multi-reinforcement-learning-tree/model/moments/";
const pathEpochInfos = ["avgTrainLoss.txt", "avgValLoss.txt", "stdValLoss.txt", "avgValExecutionTime.txt"];
const nextModelVersion = trainEngine.getNextVersion(path.join(__dirname, '../log'));
const nextModelLocation = path.join(__dirname, "../log/model-version-exp-replay-" + nextModelVersion);
// Loading queries
const loadingTrain = trainEngine.loadWatDivQueries('missingGenreOutput/queries', false);
const loadingValidation = trainEngine.loadWatDivQueries('missingGenreOutput/queriesVal', true);
// Tracking statistics
const totalEpochTrainLoss = [];
const epochValLoss = [];
const epochValExecutionTime = [];
const epochValStdLoss = [];
const averageSearchTime = [];
fs.mkdir(nextModelLocation, (err) => {
    if (err) {
        return console.error(err);
    }
});
// FOR DEBUGGING
Error.stackTraceLimit = Infinity;
loadingTrain.then(async () => {
    let cleanedQueries = trainEngine.queries.map(x => x.replace(/\n/g, '').replace(/\t/g, '').split('SELECT'));
    await trainEngine.awaitEngine();
    // await trainEngine.executeQueryTrain('SELECT' + cleanedQueries[1][1], ["output/dataset.nt"], false);
    await initialiseFeaturesExperienceBuffer(trainEngine.experienceBuffer, cleanedQueries);
    for (let epoch = 0; epoch < nEpochs; epoch++) {
        let epochTrainLoss = [];
        for (let i = 0; i < cleanedQueries.length; i++) {
            const querySubset = [...cleanedQueries[i]];
            querySubset.shift();
            console.log(`Query Template ${i + 1}/${cleanedQueries.length}`);
            const searchTimes = [];
            for (let j = 0; j < querySubset.length; j++) {
                const queryKey = `${i}` + `${j}`;
                for (let k = 0; k < numSim; k++) {
                    const searchTime = await trainEngine.executeQueryTrain('SELECT' + querySubset[j], ["missingGenreOutput/dataset.nt"], true, queryKey);
                    searchTimes.push(searchTime);
                    const experiences = [];
                    const features = [];
                    // Sample experiences from the buffer if we have enough prior executions
                    if (trainEngine.experienceBuffer.getSize() > 1) {
                        for (let z = 0; z < numExperiencePerSim; z++) {
                            const experience = trainEngine.experienceBuffer.getRandomExperience();
                            experiences.push(experience[0]);
                            const feature = trainEngine.experienceBuffer.getFeatures(experience[1].query);
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
        console.log(`Epoch ${epoch + 1}/${nEpochs}: Train Loss: ${avgLossTrain}, Validation Execution time: ${avgExecution}, Loss: ${avgLoss}, Std: ${stdLoss}`);
        // Checkpointing
        const checkPointLocation = path.join(nextModelLocation + "/chkp-" + epoch);
        fs.mkdir(checkPointLocation, (err) => {
            if (err) {
                return console.error(err);
            }
        });
        const epochStatisticsLocation = pathEpochInfos.map(x => path.join(checkPointLocation, x));
        console.log(epochStatisticsLocation);
        totalEpochTrainLoss.push(avgLossTrain);
        epochValLoss.push(avgLoss);
        epochValExecutionTime.push(avgExecution);
        epochValStdLoss.push(stdLoss);
        writeEpochFiles(epochStatisticsLocation, [totalEpochTrainLoss, epochValLoss, epochValStdLoss, epochValExecutionTime], epoch);
        trainEngine.engine.saveModel();
    }
    trainEngine.engine.saveModel(pathRunningMoments + "runningMomentsFeatures" + 1 + ".json");
});
async function validatePerformance(queries) {
    console.log("Running validation");
    console.log(`Start tensors ${tf.memory().numTensors}`);
    await loadingValidation;
    let cleanedQueries = trainEngine.valQueries.map(x => x.replace(/\n/g, '').replace(/\t/g, '').split('SELECT'));
    const rawExecutionTimesTemplate = [];
    for (let i = 0; i < cleanedQueries.length; i++) {
        const rawExecutionTimes = [];
        const querySubset = [...cleanedQueries[i]];
        querySubset.shift();
        // Start at j=1 because first element is empty
        for (let j = 0; j < querySubset.length; j++) {
            const queryKey = `${i}` + `${j}`;
            // Because complex queries are all the same, we have only one per template, we skew training execution to small time elapsed, 
            // should prob do something about that? Like add back the complex queries??
            for (let k = 0; k < numSimVal; k++) {
                const executionTimeRaw = await trainEngine.executeQueryValidation('SELECT' + querySubset[j], ["missingGenreOutput/dataset.nt"], queryKey);
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
    console.log(`End tensors ${tf.memory().numTensors}`);
    return [avgExecutionTime, avgExecutionTimeTemplate, stdExecutionTimeTemplate, averageLoss, stdLoss];
}
async function initialiseFeaturesExperienceBuffer(buffer, queries) {
    for (let i = 0; i < queries.length; i++) {
        const rawExecutionTimes = [];
        const querySubset = [...queries[i]];
        querySubset.shift();
        // Start at j=1 because first element is empty
        for (let j = 0; j < querySubset.length; j++) {
            const queryKey = `${i}` + `${j}`;
            const features = await trainEngine.executeQueryInitFeaturesBuffer('SELECT' + querySubset[j], ["missingGenreOutput/dataset.nt"]);
            buffer.setLeafFeaturesQuery(queryKey, features);
        }
    }
    return;
}
function stdArray(values, mean) {
    const std = Math.sqrt((values.map(x => (x - mean) ** 2).reduce((a, b) => a + b, 0) / values.length));
    return std;
}
function writeEpochFiles(fileLocations, epochInformation, epochNum) {
    for (let i = 0; i < fileLocations.length; i++) {
        fs.writeFileSync(fileLocations[i], JSON.stringify([...epochInformation[i]]));
    }
    // fs.writeFileSync('log/skippedQueries.json', JSON.stringify([...zeroJoinsFound]) , 'utf-8'); 
}
//# sourceMappingURL=run_comunica_experience_replay.js.map