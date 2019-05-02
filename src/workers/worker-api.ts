import deserializeError from 'deserialize-error';
import { EventEmitter } from 'events';
import { OpenAPIObject } from 'openapi-directory';

import {
    BackgroundRequest,
    BackgroundResponse,
    DecodeRequest,
    DecodeResponse,
    BuildApiResponse,
    BuildApiRequest,
    TestEncodingsRequest,
    TestEncodingsResponse
} from './background-worker';
import Worker from 'worker-loader!./background-worker';

import { Omit } from '../types';
import { ApiMetadata } from '../model/openapi/build-api';

const worker = new Worker();

let messageId = 0;
function getId() {
    return messageId++;
}

const emitter = new EventEmitter();

worker.addEventListener('message', (event) => {
    emitter.emit(event.data.id.toString(), event.data);
});

function callApi<
    T extends BackgroundRequest,
    R extends BackgroundResponse
>(request: Omit<T, 'id'>, transfer: any[] = []): Promise<R> {
    const id = getId();

    return new Promise<R>((resolve, reject) => {
        worker.postMessage(Object.assign({ id }, request), transfer);

        emitter.once(id.toString(), (data: R) => {
            if (data.error) {
                reject(deserializeError(data.error));
            } else {
                resolve(data);
            }
        });
    });
}

/**
 * Takes a body, asynchronously decodes it and returns the decoded buffer.
 *
 * Note that this requires transferring the _encoded_ body to a web worker,
 * so after this is run the encoded the buffer will become empty, if any
 * decoding is actually required.
 *
 * The method returns an object containing the new decoded buffer and the
 * original encoded data (transferred back) in a new buffer.
 */
export async function decodeBody(encodedBuffer: Buffer, encodings: string[]) {
    if (
        encodings.length === 0 ||
        (encodings.length === 1 && encodings[0] === 'identity')
    ) {
        // Shortcut to skip decoding when we know it's not required
        return { encoded: encodedBuffer, decoded: encodedBuffer };
    }

    const result = await callApi<DecodeRequest, DecodeResponse>({
        type: 'decode',
        buffer: encodedBuffer.buffer as ArrayBuffer,
        encodings
    }, [encodedBuffer.buffer]);

    return {
        encoded: Buffer.from(result.inputBuffer),
        decoded: Buffer.from(result.decodedBuffer)
    };
}

export async function testEncodingsAsync(decodedBuffer: Buffer) {
    return (await callApi<TestEncodingsRequest, TestEncodingsResponse>({
        type: 'test-encodings',
        decodedBuffer: decodedBuffer
    })).encodingSizes;
}

export async function buildApiMetadataAsync(spec: OpenAPIObject): Promise<ApiMetadata> {
    return (await callApi<BuildApiRequest, BuildApiResponse>({
        type: 'build-api',
        spec
    })).api;
}