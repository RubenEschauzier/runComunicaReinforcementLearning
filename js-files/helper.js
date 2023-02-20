"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.experienceBuffer = exports.updateRunningMoments = void 0;
function updateRunningMoments(toUpdateAggregate, newValue) {
    toUpdateAggregate.N += 1;
    const delta = newValue - toUpdateAggregate.mean;
    toUpdateAggregate.mean += delta / toUpdateAggregate.N;
    const newDelta = newValue - toUpdateAggregate.mean;
    toUpdateAggregate.M2 += delta * newDelta;
    toUpdateAggregate.std = Math.sqrt(toUpdateAggregate.M2 / toUpdateAggregate.N);
}
exports.updateRunningMoments = updateRunningMoments;
class experienceBuffer {
    constructor(maxSize, numQueries) {
    }
    getExperience(queryKey, joinPlanKey) {
        return this.exerienceBuffer.get(queryKey)?.get(joinPlanKey);
    }
    setExperience(queryKey, joinPlanKey, experience) {
        if (this.getExperience(queryKey, joinPlanKey)) {
            return;
        }
        // this.exerienceBuffer.set(queryKey, )
    }
}
exports.experienceBuffer = experienceBuffer;
//# sourceMappingURL=helper.js.map