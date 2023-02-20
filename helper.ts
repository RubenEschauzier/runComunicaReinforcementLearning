import { IAggregateValues, IResultSetRepresentation } from "@comunica/mediator-join-reinforcement-learning";


export function updateRunningMoments(toUpdateAggregate: IAggregateValues, newValue: number){
    toUpdateAggregate.N +=1;
    const delta = newValue - toUpdateAggregate.mean; 
    toUpdateAggregate.mean += delta / toUpdateAggregate.N;
    const newDelta = newValue - toUpdateAggregate.mean;
    toUpdateAggregate.M2 += delta * newDelta;
    toUpdateAggregate.std = Math.sqrt(toUpdateAggregate.M2 / toUpdateAggregate.N);
}

export function idxToKey(indexes: number[][]){
    return indexes.flat().toString().replaceAll(',', '');
}

export function keyToIdx(key: string){
    const chars = key.split('');
    const idx: number[][]=[];
    for (let i=0;i<chars.length;i+=2){
      idx.push([+chars[i], +chars[i+1]]);
    }
    return idx;
}

export class experienceBuffer{
    /**
     * FIFO query execution buffer operating on principle of FIFO
     * @param maxSize Maximal number of experiences in buffer
     */
    experienceBufferMap: Map<number,Map<string,IExperience>>;
    queryLeafFeatures: Map<number, IResultSetRepresentation>;
    experienceAgeTracker: IExperienceKey[];
    size: number;
    maxSize: number;
    constructor(maxSize: number, numQueries: number){
        this.experienceAgeTracker = [];
        for (let i=0;i<numQueries;i++){
            this.experienceBufferMap.set(i, new Map<string, IExperience>());
            this.queryLeafFeatures.set(i, {hiddenStates: [], memoryCell: []})
        }
        this.maxSize = maxSize;
        this.size = 0;
    }

    public getExperience(queryKey: number, joinPlanKey: string){
        return this.experienceBufferMap.get(queryKey)?.get(joinPlanKey);
    }

    public getRandomExperience(){
        const index = (Math.random() * (this.getSize()) ) << 0;
        const key = this.experienceAgeTracker[index];
        console.log(index);
        return this.getExperience(key.query, key.joinPlanKey);
    }
    
    public setExperience(queryKey: number, joinPlanKey: string, experience: IExperience){
        const existingExperience = this.getExperience(queryKey, joinPlanKey);
        if (existingExperience){
            existingExperience.actualExecutionTime += ((experience.actualExecutionTime - existingExperience.actualExecutionTime)/(existingExperience.N+1));
            existingExperience.N += 1;
            return;
        }
        this.experienceBufferMap.get(queryKey)!.set(joinPlanKey, experience);
        this.experienceAgeTracker.push({query: queryKey, joinPlanKey: joinPlanKey});
        if (this.getSize()>this.maxSize){
            const removedElement: IExperienceKey = this.experienceAgeTracker.shift()!;
            this.experienceBufferMap.get(queryKey)!.delete(removedElement.joinPlanKey);
        }
        else{
            this.size += 1;
        }
        return;
    }

    public getSize(){
        return this.size;
    }

}

export interface IExperience{
    actualExecutionTime: number;
    joinIndexes: number[][]
    N: number;
}
export interface IExperienceKey{
    query: number;
    joinPlanKey: string;
}
  