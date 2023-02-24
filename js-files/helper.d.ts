import { IAggregateValues, IResultSetRepresentation } from "@comunica/mediator-join-reinforcement-learning";
export declare function updateRunningMoments(toUpdateAggregate: IAggregateValues, newValue: number): void;
export declare function idxToKey(indexes: number[][]): string;
export declare function keyToIdx(key: string): number[][];
export declare class ExperienceBuffer {
    experienceBufferMap: Map<string, Map<string, IExperience>>;
    queryLeafFeatures: Map<string, IResultSetRepresentation>;
    experienceAgeTracker: IExperienceKey[];
    size: number;
    maxSize: number;
    /**
     * FIFO query execution buffer. We use this for periodical training. This allows for better data efficiency since the model is incredibly light weight
     * while query execution is the main bottleneck.
     * @param maxSize Maximal number of experiences in buffer
     * @param numQueries The total number of queries in the training data
    */
    constructor(maxSize: number, numQueries: number);
    getExperience(queryKey: string, joinPlanKey: string): IExperience | undefined;
    getRandomExperience(): [IExperience, IExperienceKey];
    getFeatures(query: string): IResultSetRepresentation | undefined;
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
    setExperience(queryKey: string, joinPlanKey: string, experience: IExperience, runningMomentsY: IAggregateValues): void;
    refreshExistingExperience(): void;
    setLeafFeaturesQuery(queryKey: string, leafFeatures: IResultSetRepresentation): void;
    getNumJoinsQuery(queryKey: string): number | undefined;
    getSize(): number;
}
export interface IExperience {
    actualExecutionTimeNorm: number;
    actualExecutionTimeRaw: number;
    joinIndexes: number[][];
    N: number;
}
export interface IExperienceKey {
    query: string;
    joinPlanKey: string;
}
