import { browser, Bookmarks } from 'webextension-polyfill-ts'

import * as index from '..'
import { Dexie, StorageManager } from '../types'
import SearchStorage from './storage'
import QueryBuilder from '../query-builder'
import { TabManager } from 'src/activity-logger/background'
import { makeRemotelyCallable } from 'src/util/webextensionRPC'
import { PageSearchParams, AnnotSearchParams, AnnotPage } from './types'
import { annotSearchOnly, pageSearchOnly } from './utils'
import { Annotation } from 'src/direct-linking/types'
import { SearchError, BadTermError, InvalidSearchError } from './errors'

export default class SearchBackground {
    private backend
    private storage: SearchStorage
    private tabMan: TabManager
    private queryBuilderFactory: () => QueryBuilder
    private getDb: () => Promise<Dexie>
    private legacySearch

    static handleSearchError(e: SearchError) {
        if (e instanceof BadTermError) {
            return {
                docs: [],
                resultsExhausted: true,
                totalCount: null,
                isBadTerm: true,
            }
        }

        // Default error case
        return {
            docs: [],
            resultsExhausted: true,
            totalCount: null,
            isInvalidSearch: true,
        }
    }

    static shapePageResult(results, limit: number) {
        return {
            resultsExhausted: results.length < limit,
            totalCount: results.length,
            docs: results,
        }
    }

    constructor({
        storageManager,
        getDb,
        tabMan,
        queryBuilder = () => new QueryBuilder(),
        idx = index,
        bookmarksAPI = browser.bookmarks,
    }: {
        storageManager: StorageManager
        getDb: () => Promise<Dexie>
        queryBuilder?: () => QueryBuilder
        tabMan: TabManager
        idx?: typeof index
        bookmarksAPI?: Bookmarks.Static
    }) {
        this.tabMan = tabMan
        this.getDb = getDb
        this.queryBuilderFactory = queryBuilder
        this.storage = new SearchStorage({ storageManager })
        this.initBackend(idx)

        this.legacySearch = idx.fullSearch(getDb)

        // Handle any new browser bookmark actions (bookmark mananger or bookmark btn in URL bar)
        bookmarksAPI.onCreated.addListener(
            this.handleBookmarkCreation.bind(this),
        )
        bookmarksAPI.onRemoved.addListener(
            this.handleBookmarkRemoval.bind(this),
        )
    }

    private initBackend(idx: typeof index) {
        this.backend = {
            addPage: idx.addPage(this.getDb),
            addPageTerms: idx.addPageTerms(this.getDb),
            updateTimestampMeta: idx.updateTimestampMeta(this.getDb),
            addVisit: idx.addVisit(this.getDb),
            addFavIcon: idx.addFavIcon(this.getDb),
            delPages: idx.delPages(this.getDb),
            delPagesByDomain: idx.delPagesByDomain(this.getDb),
            delPagesByPattern: idx.delPagesByPattern(this.getDb),
            addTag: idx.addTag(this.getDb),
            delTag: idx.delTag(this.getDb),
            fetchPageTags: idx.fetchPageTags(this.getDb),
            addBookmark: idx.addBookmark(this.getDb),
            delBookmark: idx.delBookmark(this.getDb),
            pageHasBookmark: idx.pageHasBookmark(this.getDb),
            getPage: idx.getPage(this.getDb),
            grabExistingKeys: idx.grabExistingKeys(this.getDb),
            search: idx.search(this.getDb),
            suggest: idx.suggest(this.getDb),
            extendedSuggest: idx.extendedSuggest(this.getDb),
            getMatchingPageCount: idx.getMatchingPageCount(this.getDb),
            domainHasFavIcon: idx.domainHasFavIcon(this.getDb),
            createPageFromTab: idx.createPageFromTab(this.getDb),
            createPageFromUrl: idx.createPageFromUrl(this.getDb),
        }
    }

    setupRemoteFunctions() {
        makeRemotelyCallable({
            search: this.backend.search,
            addTag: this.backend.addTag,
            delTag: this.backend.delTag,
            suggest: this.backend.suggest,
            delPages: this.backend.delPages,
            addBookmark: this.backend.addBookmark,
            delBookmark: this.backend.delBookmark,
            fetchPageTags: this.backend.fetchPageTags,
            extendedSuggest: this.backend.extendedSuggest,
            delPagesByDomain: this.backend.delPagesByDomain,
            delPagesByPattern: this.backend.delPagesByPattern,
            getMatchingPageCount: this.backend.getMatchingPageCount,
            searchAnnotations: this.searchAnnotations.bind(this),
            searchPages: this.searchPages.bind(this),
        })
    }

    private processSearchParams(
        {
            query,
            domainsInc,
            domainsExc,
            tagsInc,
            collections,
            contentTypes = { notes: true, highlights: true, pages: true },
            skip = 0,
            limit = 10,
            ...params
        }: any,
        ignoreBadSearch = false,
    ) {
        // Extract query terms and in-query-filters via QueryBuilder
        const qb = this.queryBuilderFactory()
            .searchTerm(query)
            .filterDomains(domainsInc)
            .filterExcDomains(domainsExc)
            .filterTags(tagsInc)
            .filterLists(collections)
            .get()

        if (qb.isBadTerm && !ignoreBadSearch) {
            throw new BadTermError()
        }

        if (qb.isInvalidSearch && !ignoreBadSearch) {
            throw new InvalidSearchError()
        }

        return {
            ...params,
            tagsInc: qb.tags,
            termsInc: qb.terms,
            termsExc: qb.termsExclude,
            domainsInc: qb.domains,
            domainsExc: qb.domainsExclude,
            collections: qb.lists,
            includeNotes: contentTypes.notes,
            includeHighlights: contentTypes.highlights,
            isBlankSearch: !qb.terms.length,
            bookmarksOnly: params.showOnlyBookmarks || params.bookmarksOnly,
            contentTypes,
            limit,
            skip,
        }
    }

    private mergeSearchResults(results: Array<AnnotPage[]>): AnnotPage[] {
        const pageMap = new Map<string, [Partial<AnnotPage>, Annotation[]]>()

        // Dedupe and group results by page
        for (const searchRes of results) {
            for (const { annotations, ...page } of searchRes) {
                const entry = pageMap.get(page.url)

                let annots =
                    entry == null ? annotations : [...entry[1], ...annotations]

                const urls = new Set(annots.map(a => a.pageUrl))
                annots = annots.filter(annot => urls.has(annot.pageUrl))

                pageMap.set(page.url, [page, annots])
            }
        }

        // Convert Map back to array of results
        return [...pageMap.values()].map(
            ([page, annotations]) =>
                ({
                    ...page,
                    annotations,
                } as AnnotPage),
        )
    }

    private async combinedSearch(params: AnnotSearchParams) {
        // Manually apply skip post-search
        const skip = params.skip
        delete params.skip

        const results = await Promise.all([
            this.storage.searchPages(params, this.legacySearch),
            this.storage.searchAnnots({
                ...params,
                includePageResults: true,
            }),
        ])

        const mergedResults = this.mergeSearchResults(results as Array<
            AnnotPage[]
        >)

        return mergedResults.slice(skip, params.limit)
    }

    private async blankPageSearch({
        contentTypes,
        ...params
    }: PageSearchParams) {
        if (annotSearchOnly(contentTypes)) {
            return this.storage.searchPagesByLatestAnnotation(params)
        }

        let results = await this.storage.searchPages(params, this.legacySearch)

        results = await Promise.all(
            results.map(async page => ({
                ...page,
                annotations: await this.storage.listAnnotations({
                    ...params,
                    limit: params.maxAnnotsPerPage,
                    url: page.url,
                }),
            })),
        )

        return results
    }

    async searchAnnotations(params: AnnotSearchParams): Promise<Annotation[]> {
        const searchParams = this.processSearchParams(params, true)

        if (searchParams.isBadTerm || searchParams.isInvalidSearch) {
            return []
        }

        // Blank search; just list annots, applying search filters
        if (searchParams.isBlankSearch) {
            return this.storage.listAnnotations(searchParams)
        }

        return this.storage.searchAnnots({
            ...searchParams,
            includePageResults: false,
        }) as any
    }

    async searchPages(params: PageSearchParams) {
        let searchParams

        try {
            searchParams = this.processSearchParams(params)
        } catch (e) {
            return SearchBackground.handleSearchError(e)
        }

        // Blank search; just list annots, applying search filters
        if (searchParams.isBlankSearch) {
            return SearchBackground.shapePageResult(
                await this.blankPageSearch(searchParams),
                searchParams.limit,
            )
        }

        if (pageSearchOnly(searchParams.contentTypes)) {
            return SearchBackground.shapePageResult(
                await this.storage.searchPages(searchParams, this.legacySearch),
                searchParams.limit,
            )
        }

        if (annotSearchOnly(searchParams.contentTypes)) {
            return SearchBackground.shapePageResult(
                await this.storage.searchAnnots({
                    ...searchParams,
                    includePageResults: true,
                }),
                searchParams.limit,
            )
        }

        return SearchBackground.shapePageResult(
            await this.combinedSearch(searchParams),
            searchParams.limit,
        )
    }

    async handleBookmarkRemoval(id, { node }) {
        // Created folders won't have `url`; ignore these
        if (!node.url) {
            return
        }

        return this.backend.delBookmark(node).catch(console.error)
    }

    async handleBookmarkCreation(id, node) {
        // Created folders won't have `url`; ignore these
        if (!node.url) {
            return
        }

        let tabId
        const activeTab = this.tabMan.getActiveTab()

        if (activeTab != null && activeTab.url === node.url) {
            tabId = activeTab.id
        }

        return this.backend.addBookmark({ url: node.url, tabId })
    }
}
