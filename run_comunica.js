"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const path = require("path");
class trainComunicaModel {
    constructor() {
        const QueryEngine = require('@comunica/query-sparql-file').QueryEngineFactory;
        this.engine = new QueryEngine().create();
        this.batchedTrainingExamples = { trainingExamples: new Map };
        this.queries = [];
    }
    async executeQueryTrain(query, sources) {
        this.engine = await this.engine;
        const starthrTime = process.hrtime();
        const startTime = starthrTime[0] + starthrTime[1] / 1000000000;
        const bindingsStream = await this.engine.queryBindings(query, { sources: sources, batchedTrainingExamples: this.batchedTrainingExamples });
        if (this.engine.trainEpisode.joinsMade.length == 0) {
            throw new Error("Training episode contained 0 joins");
        }
        const joinOrderKeys = [];
        // Get joins made in this query to update
        for (let i = 1; i < this.engine.trainEpisode.joinsMade.length; i++) {
            const joinIndexId = this.engine.trainEpisode.joinsMade.slice(0, i);
            joinOrderKeys.push(this.idxToKey(joinIndexId));
        }
        this.addListener(bindingsStream, startTime, joinOrderKeys);
        return bindingsStream;
    }
    cleanBatchTrainingExamples() {
        // First dispose of the Q-value tensors
        for (const [, value] of this.batchedTrainingExamples.trainingExamples.entries()) {
            value.qValue.dispose();
        }
        this.batchedTrainingExamples = { trainingExamples: new Map };
    }
    async loadWatDivQueries(queryDir) {
        const loadingComplete = new Promise(async (resolve, reject) => {
            try {
                // Get the files as an array
                const files = await fs.promises.readdir(queryDir);
                for (const file of files) {
                    // Get the full paths
                    const filePath = path.join(queryDir, file);
                    const data = fs.readFileSync(filePath, 'utf8');
                    this.queries.push(data);
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
    addListener(bindingStream, startTime, joinsMadeEpisode) {
        /**
         * Function that consumes the binding stream, measures elapsed time, and updates the batchTrainEpisode
         */
        let numEntriesPassed = 0;
        const finishedReading = new Promise((resolve, reject) => {
            bindingStream.on('data', (binding) => {
                numEntriesPassed += 1;
            });
            bindingStream.on('end', () => {
                const end = process.hrtime();
                const endTime = end[0] + end[1] / 1000000000;
                const elapsed = endTime - startTime;
                for (const joinMade of joinsMadeEpisode) {
                    const trainingExample = this.batchedTrainingExamples.trainingExamples.get(joinMade);
                    if (!trainingExample) {
                        throw new Error("Training example given that is not in batched episode");
                    }
                    if (trainingExample.actualExecutionTime == -1) {
                        trainingExample.actualExecutionTime = elapsed;
                    }
                    else {
                        trainingExample.actualExecutionTime = trainingExample.actualExecutionTime +
                            ((elapsed - trainingExample.actualExecutionTime) / trainingExample.N + 1);
                    }
                    trainingExample.N += 1;
                }
                resolve(true);
            });
        });
        return finishedReading;
    }
    async awaitEngine() {
        this.engine = await this.engine;
    }
    idxToKey(indexes) {
        return indexes.flat().toString().replaceAll(',', '');
    }
}
const numSim = 10;
const trainEngine = new trainComunicaModel();
const loading = trainEngine.loadWatDivQueries('output/queries');
loading.then(async () => {
    let cleanedQueries = trainEngine.queries.map(x => x.replace(/\n/g, '').replace(/\t/g, '').split('SELECT'));
    for (let i = 0; i < cleanedQueries.length; i++) {
        const querySubset = [...cleanedQueries[i]];
        querySubset.shift();
        for (let j = 0; j < querySubset.length; j++) {
            for (let k = 0; k < numSim; k++) {
                const consumedBindingStream = await trainEngine.executeQueryTrain('SELECT' + querySubset[j], ["output/dataset.nt"]);
                break;
            }
            break;
        }
        break;
    }
});
//# sourceMappingURL=run_comunica.js.map