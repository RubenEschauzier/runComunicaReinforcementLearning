"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.trainComunicaModel = void 0;
const helper_1 = require("./helper");
const fs = require("fs");
const path = require("path");
// Command to create endpoint:
// node node_modules/@comunica/query-sparql-file/bin/http.js -c "{\"sources\":[\"missingGenreOutput/dataset.nt\"], \"trainEndPoint\":true}"
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
            batchedTrainingExamples: this.batchedValidationExamples, train: false });
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
        const finishedReading = new Promise((resolve, reject) => {
            bindingStream.on('data', (binding) => {
            });
            bindingStream.on('end', () => {
                const endTime = this.getTimeSeconds();
                const elapsed = endTime - startTime;
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
                resolve(elapsed);
            });
        });
        return finishedReading;
    }
    addListenerTimeOut(bindingStream, startTime, joinsMadeEpisode, queryKey, validation, recordExperience) {
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
exports.trainComunicaModel = trainComunicaModel;
const trainEngine = new trainComunicaModel(1500);
const loadingTrain = trainEngine.loadWatDivQueries('missingGenreOutput/queries', false);
const loadingValidation = trainEngine.loadWatDivQueries('missingGenreOutput/queriesVal', true);
Error.stackTraceLimit = Infinity;
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
    try {
        const testStream = await trainEngine.engine.query(cleanedQueries[0][0], { sources: ['http://localhost:3000/sparql'], train: true, queryKey: '00' }, 'parsed');
    }
    catch (err) {
        console.log(err);
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
//# sourceMappingURL=run_comunica_endpoint.js.map