/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { parse } from "url";
import { assert } from "@fluidframework/common-utils";
import {
    IDocumentService,
    IDocumentServiceFactory,
    IResolvedUrl,
} from "@fluidframework/driver-definitions";
import { ITelemetryBaseLogger } from "@fluidframework/common-definitions";
import { ISummaryTree } from "@fluidframework/protocol-definitions";
import { ICredentials, IGitCache } from "@fluidframework/server-services-client";
import {
    ensureFluidResolvedUrl,
    getDocAttributesFromProtocolSummary,
    getQuorumValuesFromProtocolSummary,
} from "@fluidframework/driver-utils";
import { ChildLogger } from "@fluidframework/telemetry-utils";
import { DocumentService } from "./documentService";
import { DocumentService2 } from "./documentService2";
import { ITokenProvider } from "./tokens";
import { RouterliciousOrdererRestWrapper } from "./restWrapper";

/**
 * Factory for creating the routerlicious document service. Use this if you want to
 * use the routerlicious implementation.
 */
export class RouterliciousDocumentServiceFactory implements IDocumentServiceFactory {
    public readonly protocolName = "fluid:";
    constructor(
        private readonly tokenProvider: ITokenProvider,
        private readonly useDocumentService2: boolean = false,
        private readonly disableCache: boolean = false,
        private readonly historianApi: boolean = true,
        private readonly gitCache: IGitCache | undefined = undefined,
        private readonly credentials?: ICredentials,
    ) {
    }

    public async createContainer(
        createNewSummary: ISummaryTree,
        resolvedUrl: IResolvedUrl,
        logger?: ITelemetryBaseLogger,
    ): Promise<IDocumentService> {
        ensureFluidResolvedUrl(resolvedUrl);
        assert(!!resolvedUrl.endpoints.ordererUrl, 0x0b2 /* "Missing orderer URL!" */);
        const parsedUrl = parse(resolvedUrl.url);
        if (!parsedUrl.pathname) {
            throw new Error("Parsed url should contain tenant and doc Id!!");
        }
        const [, tenantId, id] = parsedUrl.pathname.split("/");
        const protocolSummary = createNewSummary.tree[".protocol"] as ISummaryTree;
        const appSummary = createNewSummary.tree[".app"] as ISummaryTree;
        if (!(protocolSummary && appSummary)) {
            throw new Error("Protocol and App Summary required in the full summary");
        }
        const documentAttributes = getDocAttributesFromProtocolSummary(protocolSummary);
        const quorumValues = getQuorumValuesFromProtocolSummary(protocolSummary);

        const logger2 = ChildLogger.create(logger, "RouterliciousDriver");
        const ordererRestWrapper = await RouterliciousOrdererRestWrapper.load(
            tenantId,
            id,
            this.tokenProvider,
            logger2,
            resolvedUrl.endpoints.ordererUrl,
        );
        await ordererRestWrapper.post(
            `/documents/${tenantId}`,
            {
                id,
                summary: appSummary,
                sequenceNumber: documentAttributes.sequenceNumber,
                values: quorumValues,
            },
        );

        return this.createDocumentService(resolvedUrl, logger);
    }

    /**
     * Creates the document service after extracting different endpoints URLs from a resolved URL.
     *
     * @param resolvedUrl - URL containing different endpoint URLs.
     * @returns Routerlicious document service.
     */
    public async createDocumentService(
        resolvedUrl: IResolvedUrl,
        logger?: ITelemetryBaseLogger,
    ): Promise<IDocumentService> {
        ensureFluidResolvedUrl(resolvedUrl);

        const fluidResolvedUrl = resolvedUrl;
        const storageUrl = fluidResolvedUrl.endpoints.storageUrl;
        const ordererUrl = fluidResolvedUrl.endpoints.ordererUrl;
        const deltaStorageUrl = fluidResolvedUrl.endpoints.deltaStorageUrl;
        if (!ordererUrl || !deltaStorageUrl) {
            throw new Error(
                `All endpoints urls must be provided. [ordererUrl:${ordererUrl}][deltaStorageUrl:${deltaStorageUrl}]`);
        }

        const parsedUrl = parse(fluidResolvedUrl.url);
        const [, tenantId, documentId] = parsedUrl.pathname!.split("/");
        if (!documentId || !tenantId) {
            throw new Error(
                `Couldn't parse documentId and/or tenantId. [documentId:${documentId}][tenantId:${tenantId}]`);
        }

        const logger2 = ChildLogger.create(logger, "RouterliciousDriver");

        if (this.useDocumentService2) {
            return new DocumentService2(
                fluidResolvedUrl,
                ordererUrl,
                deltaStorageUrl,
                storageUrl,
                this.disableCache,
                this.historianApi,
                this.credentials,
                logger2,
                this.tokenProvider,
                tenantId,
                documentId);
        } else {
            return new DocumentService(
                fluidResolvedUrl,
                ordererUrl,
                deltaStorageUrl,
                storageUrl,
                this.disableCache,
                this.historianApi,
                this.credentials,
                this.gitCache,
                logger2,
                this.tokenProvider,
                tenantId,
                documentId);
        }
    }
}
