import { IAggregateValues, IResultSetRepresentation } from "@comunica/mediator-join-reinforcement-learning";
export declare function updateRunningMoments(toUpdateAggregate: IAggregateValues, newValue: number): void;
export declare class experienceBuffer {
    /**
     * FIFO query execution buffer operating on principle of FIFO
     * @param maxSize Maximal number of experiences in buffer
     */
    exerienceBuffer: Map<number, Map<string, object>>;
    queryLeafFeatures: Map<number, IResultSetRepresentation>;
    constructor(maxSize: number, numQueries: number);
    getExperience(queryKey: number, joinPlanKey: string): object | undefined;
    setExperience(queryKey: number, joinPlanKey: string, experience: IExperience): void;
}
export interface IExperience {
    qValue: number;
    actualExecutionTime: number;
}
