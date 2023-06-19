declare class runExperiments {
    engine: any;
    queryEngineFactory: any;
    constructor();
    createEngine(): Promise<void>;
    getTimeSeconds(): number;
}
declare const query = "SELECT ?v0 ?v1 ?v3 WHERE {\n\t?v0 <http://purl.org/dc/terms/Location> ?v1 .\n\t?v0 <http://schema.org/nationality> <http://db.uwaterloo.ca/~galuc/wsdbm/Country24> .\n\t?v0 <http://db.uwaterloo.ca/~galuc/wsdbm/gender> ?v3 .\n\t?v0 <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://db.uwaterloo.ca/~galuc/wsdbm/Role2> .\n}";
declare const runner: runExperiments;
