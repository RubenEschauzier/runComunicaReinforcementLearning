"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExperienceBuffer = exports.keyToIdx = exports.idxToKey = exports.updateRunningMoments = void 0;
function updateRunningMoments(toUpdateAggregate, newValue) {
    toUpdateAggregate.N += 1;
    const delta = newValue - toUpdateAggregate.mean;
    toUpdateAggregate.mean += delta / toUpdateAggregate.N;
    const newDelta = newValue - toUpdateAggregate.mean;
    toUpdateAggregate.M2 += delta * newDelta;
    toUpdateAggregate.std = Math.sqrt(toUpdateAggregate.M2 / toUpdateAggregate.N);
}
exports.updateRunningMoments = updateRunningMoments;
function idxToKey(indexes) {
    return indexes.flat().toString().replaceAll(',', '');
}
exports.idxToKey = idxToKey;
function keyToIdx(key) {
    const chars = key.split('');
    const idx = [];
    for (let i = 0; i < chars.length; i += 2) {
        idx.push([+chars[i], +chars[i + 1]]);
    }
    return idx;
}
exports.keyToIdx = keyToIdx;
class ExperienceBuffer {
    /**
     * FIFO query execution buffer. We use this for periodical training. This allows for better data efficiency since the model is incredibly light weight
     * while query execution is the main bottleneck.
     * @param maxSize Maximal number of experiences in buffer
     * @param numQueries The total number of queries in the training data
    */
    constructor(maxSize, numQueries) {
        this.experienceBufferMap = new Map();
        this.queryLeafFeatures = new Map();
        this.experienceAgeTracker = [];
        this.maxSize = maxSize;
        this.size = 0;
    }
    getExperience(queryKey, joinPlanKey) {
        return this.experienceBufferMap.get(queryKey)?.get(joinPlanKey);
    }
    getRandomExperience() {
        const index = (Math.random() * (this.getSize())) << 0;
        const key = this.experienceAgeTracker[index];
        return [this.getExperience(key.query, key.joinPlanKey), key];
    }
    getFeatures(query) {
        const features = this.queryLeafFeatures.get(query);
        if (!features) {
            console.error("Query requested with no leaf features");
        }
        return features;
    }
    /**
     * Function to set a new experience.
     * For incomplete join plans we keep track of the best recorded execution time from the partial join plan
     * For complete join plans we track the average execution time during training
     * When the maximum number of experiences is reached, the buffer acts as a queue and removes the oldest experience
     * When an already existing experience is revisted we DON'T refresh the age of the experience
     *
     * @param queryKey The query number of the executed query
     * @param joinPlanKey The key representing the experienced joinplan
     * @param experience The information obtained during query execution
     * @returns
     */
    setExperience(queryKey, joinPlanKey, experience, runningMomentsY) {
        const fullJoinPlanKeyLength = this.getNumJoinsQuery(queryKey);
        if (!fullJoinPlanKeyLength) {
            throw new Error("Uninitialised query key");
        }
        const existingExperience = this.getExperience(queryKey, joinPlanKey);
        const joinPlanKeyArray = keyToIdx(joinPlanKey);
        // True if we have complete join plan
        const fullJoinPlan = joinPlanKeyArray.length == fullJoinPlanKeyLength;
        if (existingExperience) {
            /**
             * Note that this function is not entirely correct, if the average execution time goes up due to chance it is not reflected in the execution time
             *of partial join plans that use the execution time of a complete join plan. This difference should be small though.
             */
            if (fullJoinPlan) {
                // Update unnormalized execution time average
                existingExperience.actualExecutionTimeRaw += ((experience.actualExecutionTimeRaw - existingExperience.actualExecutionTimeRaw) / (existingExperience.N + 1));
                existingExperience.N += 1;
                // Update the normalized execution time using new average raw value
                existingExperience.actualExecutionTimeNorm = (existingExperience.actualExecutionTimeRaw - runningMomentsY.mean) / runningMomentsY.std;
                return;
            }
            // If partial we update to see if the recorded raw execution time is better than previous max, we use raw because the normalized can change
            // due to underlying statistics changing
            const existingExecutionTime = existingExperience.actualExecutionTimeRaw;
            if (existingExecutionTime > experience.actualExecutionTimeRaw) {
                existingExperience.actualExecutionTimeRaw = experience.actualExecutionTimeRaw;
            }
            existingExperience.N += 1;
            // Update the normalized execution times (At the start this can give big changes, but should be stable when num executions -> infinity)
            // We update even if the recorded experience is worse than current, to reflect the changes in distribution of Y
            existingExperience.actualExecutionTimeNorm = (existingExperience.actualExecutionTimeRaw - runningMomentsY.mean) / runningMomentsY.std;
            return;
        }
        // If it doesn't exist we set new experience
        this.experienceBufferMap.get(queryKey).set(joinPlanKey, experience);
        // Add it to the 'queue' to keep track of age
        this.experienceAgeTracker.push({ query: queryKey, joinPlanKey: joinPlanKey });
        // If size exceeds max from push we remove first pushed element from the age tracker and the map
        if (this.getSize() > this.maxSize) {
            const removedElement = this.experienceAgeTracker.shift();
            this.experienceBufferMap.get(queryKey).delete(removedElement.joinPlanKey);
        }
        // If we're under max size we increase size, if at max size the size stays the same
        else {
            this.size += 1;
        }
        return;
    }
    refreshExistingExperience() {
    }
    setLeafFeaturesQuery(queryKey, leafFeatures) {
        this.queryLeafFeatures.set(queryKey, leafFeatures);
        this.experienceBufferMap.set(queryKey, new Map());
    }
    getNumJoinsQuery(queryKey) {
        return this.queryLeafFeatures.get(queryKey)?.hiddenStates.length;
    }
    getSize() {
        return this.size;
    }
}
exports.ExperienceBuffer = ExperienceBuffer;
//# sourceMappingURL=helper.js.map