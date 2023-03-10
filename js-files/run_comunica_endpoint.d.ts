import { IResultSetRepresentation, IRunningMoments } from "@comunica/mediator-join-reinforcement-learning";
import { BindingsStream, IBatchedTrainingExamples } from "@comunica/types";
import { ExperienceBuffer } from "./helper";
export declare class trainComunicaModel {
    engine: any;
    queries: string[];
    valQueries: string[];
    batchedTrainingExamples: IBatchedTrainingExamples;
    batchedValidationExamples: IBatchedTrainingExamples;
    runningMomentsExecutionTime: IRunningMoments;
    experienceBuffer: ExperienceBuffer;
    constructor(bufferSize: number);
    executeQueryTrain(query: string, sources: string[], train: boolean, queryKey: string, runningMomentsFeatureFile?: string): Promise<number>;
    executeQueryValidation(query: string, sources: string[], queryKey: string): Promise<number>;
    executeQueryInitFeaturesBuffer(query: string, sources: string[]): Promise<IResultSetRepresentation>;
    cleanBatchTrainingExamples(): void;
    cleanBatchTrainingExamplesValidation(): void;
    loadWatDivQueries(queryDir: string, val: boolean): Promise<boolean>;
    getNextVersion(queryDir: string): number;
    addListener(bindingStream: BindingsStream, startTime: number, joinsMadeEpisode: string[], queryKey: string, validation: boolean, recordExperience: boolean): Promise<number>;
    addListenerTimeOut(bindingStream: BindingsStream, startTime: number, joinsMadeEpisode: string[], queryKey: string, validation: boolean, recordExperience: boolean): Promise<number>;
    awaitEngine(): Promise<void>;
    getTimeSeconds(): number;
    protected idxToKey(indexes: number[][]): string;
}
