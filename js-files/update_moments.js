"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateRunningMoments = void 0;
function updateRunningMoments(toUpdateAggregate, newValue) {
    toUpdateAggregate.N += 1;
    const delta = newValue - toUpdateAggregate.mean;
    toUpdateAggregate.mean += delta / toUpdateAggregate.N;
    const newDelta = newValue - toUpdateAggregate.mean;
    toUpdateAggregate.M2 += delta * newDelta;
    toUpdateAggregate.std = Math.sqrt(toUpdateAggregate.M2 / toUpdateAggregate.N);
}
exports.updateRunningMoments = updateRunningMoments;
//# sourceMappingURL=update_moments.js.map