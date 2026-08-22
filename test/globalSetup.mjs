import { MongoMemoryReplSet } from "mongodb-memory-server";

// An in-memory MongoDB for the whole test run.
//
// It MUST be a replica set, not a standalone mongod. adjustStock wraps its
// work in a transaction, and MongoDB only supports transactions on a replica
// set -- a standalone instance throws "Transaction numbers are only allowed on
// a replica set member or mongos". A single-node replica set is enough and
// starts quickly.

let replSet;

export default async function setup({ provide }) {
    // Leave the storage engine at its default. Passing storageEngine
    // explicitly makes mongod 8.x exit immediately on Windows, which surfaces
    // only as ECONNREFUSED when the driver tries to run replSetInitiate.
    replSet = await MongoMemoryReplSet.create({
        replSet: { count: 1 },
    });

    provide("mongoUri", replSet.getUri());

    return async () => {
        if (replSet) await replSet.stop();
    };
}
