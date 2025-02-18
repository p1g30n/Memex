import expect from 'expect'
import {
    backgroundIntegrationTestSuite,
    backgroundIntegrationTest,
    BackgroundIntegrationTestSetup,
} from 'src/tests/integration-tests'
import { StorageCollectionDiff } from 'src/tests/storage-change-detector'

const customLists = (setup: BackgroundIntegrationTestSetup) =>
    setup.backgroundModules.customLists
const searchModule = (setup: BackgroundIntegrationTestSetup) =>
    setup.backgroundModules.search
let listId!: any
let listEntry!: any

export const INTEGRATION_TESTS = backgroundIntegrationTestSuite(
    'Custom lists',
    [
        backgroundIntegrationTest(
            'should create a list, edit its title, add an entry to it and retrieve the list and its pages',
            () => {
                return {
                    steps: [
                        {
                            execute: async ({ setup }) => {
                                listId = await customLists(
                                    setup,
                                ).createCustomList({
                                    name: 'My Custom List',
                                })
                            },
                            expectedStorageChanges: {
                                customLists: (): StorageCollectionDiff => ({
                                    [listId]: {
                                        type: 'create',
                                        object: {
                                            id: listId,
                                            createdAt: expect.any(Date),
                                            name: 'My Custom List',
                                            isDeletable: true,
                                            isNestable: true,
                                        },
                                    },
                                }),
                            },
                        },
                        {
                            execute: async ({ setup }) => {
                                listEntry = (await customLists(
                                    setup,
                                ).insertPageToList({
                                    id: listId,
                                    url: 'http://www.bla.com/',
                                })).object
                            },
                            expectedStorageChanges: {
                                pageListEntries: (): StorageCollectionDiff => ({
                                    [listEntry &&
                                    `[${listId},"${listEntry.pageUrl}"]`]: {
                                        type: 'create',
                                        object: {
                                            listId,
                                            createdAt: expect.any(Date),
                                            fullUrl: 'http://www.bla.com/',
                                            pageUrl: 'bla.com',
                                        },
                                    },
                                }),
                                pages: (): StorageCollectionDiff => ({
                                    'bla.com': {
                                        type: 'create',
                                        object: {
                                            canonicalUrl: undefined,
                                            domain: 'bla.com',
                                            fullTitle: undefined,
                                            fullUrl: 'http://www.bla.com/',
                                            hostname: 'bla.com',
                                            screenshot: undefined,
                                            terms: [],
                                            text: undefined,
                                            titleTerms: [],
                                            url: 'bla.com',
                                            urlTerms: [],
                                        },
                                    },
                                }),
                                visits: (): StorageCollectionDiff =>
                                    expect.any(Object),
                            },
                        },
                        {
                            execute: async ({ setup }) =>
                                customLists(setup).updateList({
                                    id: listId,
                                    name: 'Updated List Title',
                                }),
                            expectedStorageChanges: {
                                customLists: (): StorageCollectionDiff => ({
                                    [listId]: {
                                        type: 'modify',
                                        updates: {
                                            name: 'Updated List Title',
                                        },
                                    },
                                }),
                            },
                            postCheck: async ({ setup }) => {
                                expect(
                                    await customLists(setup).fetchListById({
                                        id: listId,
                                    }),
                                ).toEqual({
                                    id: expect.any(Number),
                                    name: 'Updated List Title',
                                    isDeletable: true,
                                    isNestable: true,
                                    createdAt: expect.any(Date),
                                    pages: ['http://www.bla.com/'],
                                    active: true,
                                })

                                expect(
                                    await customLists(setup).fetchListPagesById(
                                        {
                                            id: listId,
                                        },
                                    ),
                                ).toEqual([
                                    {
                                        listId,
                                        pageUrl: 'bla.com',
                                        fullUrl: 'http://www.bla.com/',
                                        createdAt: expect.any(Date),
                                    },
                                ])

                                expect(
                                    await searchModule(setup).searchPages({
                                        lists: [listId],
                                    }),
                                ).toEqual({
                                    docs: [
                                        {
                                            annotations: [],
                                            annotsCount: undefined,
                                            displayTime: expect.any(Number),
                                            favIcon: undefined,
                                            hasBookmark: false,
                                            screenshot: undefined,
                                            tags: [],
                                            title: undefined,
                                            url: 'bla.com',
                                        },
                                    ],
                                    resultsExhausted: true,
                                    totalCount: null,
                                })
                            },
                        },
                    ],
                }
            },
        ),
        backgroundIntegrationTest(
            'should create a list, add an entry of an existing page to it and retrieve the list and its pages',
            { mark: false },
            () => {
                return {
                    steps: [
                        {
                            execute: async ({ setup }) => {
                                listId = await customLists(
                                    setup,
                                ).createCustomList({
                                    name: 'My Custom List',
                                })
                            },
                        },
                        {
                            execute: async ({ setup }) => {
                                await customLists(setup).insertPageToList({
                                    id: listId,
                                    url: 'http://www.bla.com/',
                                })
                            },
                        },
                        {
                            execute: async ({ setup }) => {
                                await searchModule(setup).searchIndex.addPage({
                                    pageDoc: {
                                        url: 'http://www.bla.com/',
                                        content: {
                                            fullText: 'home page content',
                                            title: 'bla.com title',
                                        },
                                    },
                                    visits: [],
                                })
                            },
                            postCheck: async ({ setup }) => {
                                expect(
                                    await customLists(setup).fetchListById({
                                        id: listId,
                                    }),
                                ).toEqual({
                                    id: expect.any(Number),
                                    name: 'My Custom List',
                                    isDeletable: true,
                                    isNestable: true,
                                    createdAt: expect.any(Date),
                                    pages: ['http://www.bla.com/'],
                                    active: true,
                                })

                                expect(
                                    await customLists(setup).fetchListPagesById(
                                        {
                                            id: listId,
                                        },
                                    ),
                                ).toEqual([
                                    {
                                        listId,
                                        pageUrl: 'bla.com',
                                        fullUrl: 'http://www.bla.com/',
                                        createdAt: expect.any(Date),
                                    },
                                ])

                                expect(
                                    await searchModule(setup).searchPages({
                                        lists: [listId],
                                    }),
                                ).toEqual({
                                    docs: [
                                        {
                                            annotations: [],
                                            annotsCount: undefined,
                                            displayTime: expect.any(Number),
                                            favIcon: undefined,
                                            hasBookmark: false,
                                            screenshot: undefined,
                                            tags: [],
                                            title: 'bla.com title',
                                            url: 'bla.com',
                                        },
                                    ],
                                    resultsExhausted: true,
                                    totalCount: null,
                                })
                            },
                        },
                    ],
                }
            },
        ),

        backgroundIntegrationTest(
            'should create a list, add an entry to it, then remove the list and its entries',
            () => {
                return {
                    steps: [
                        {
                            execute: async ({ setup }) => {
                                listId = await customLists(
                                    setup,
                                ).createCustomList({
                                    name: 'My Custom List',
                                })
                            },
                        },
                        {
                            execute: async ({ setup }) => {
                                await customLists(setup).insertPageToList({
                                    id: listId,
                                    url: 'http://www.bla.com/',
                                })
                            },
                        },
                        {
                            preCheck: async ({ setup }) => {
                                expect(
                                    await customLists(setup).fetchListById({
                                        id: listId,
                                    }),
                                ).toEqual({
                                    id: listId,
                                    name: 'My Custom List',
                                    isDeletable: true,
                                    isNestable: true,
                                    createdAt: expect.any(Date),
                                    pages: ['http://www.bla.com/'],
                                    active: true,
                                })

                                expect(
                                    await customLists(setup).fetchListPagesById(
                                        {
                                            id: listId,
                                        },
                                    ),
                                ).toEqual([
                                    {
                                        listId,
                                        pageUrl: 'bla.com',
                                        fullUrl: 'http://www.bla.com/',
                                        createdAt: expect.any(Date),
                                    },
                                ])
                            },
                            execute: async ({ setup }) => {
                                await customLists(setup).removeList({
                                    id: listId,
                                })
                            },
                            postCheck: async ({ setup }) => {
                                expect(
                                    await customLists(setup).fetchListById({
                                        id: listId,
                                    }),
                                ).toEqual(null)
                                expect(
                                    await customLists(setup).fetchListPagesById(
                                        {
                                            id: listId,
                                        },
                                    ),
                                ).toEqual([])
                            },
                        },
                    ],
                }
            },
        ),
        backgroundIntegrationTest(
            'should create a list, add two entries to it, then remove one of the entries',
            () => {
                return {
                    steps: [
                        {
                            execute: async ({ setup }) => {
                                listId = await customLists(
                                    setup,
                                ).createCustomList({
                                    name: 'My Custom List',
                                })
                            },
                        },
                        {
                            execute: async ({ setup }) => {
                                await customLists(setup).insertPageToList({
                                    id: listId,
                                    url: 'http://www.bla.com/',
                                })
                                await customLists(setup).insertPageToList({
                                    id: listId,
                                    url: 'http://www.test.com/',
                                })
                            },
                        },
                        {
                            preCheck: async ({ setup }) => {
                                expect(
                                    await customLists(setup).fetchListPagesById(
                                        {
                                            id: listId,
                                        },
                                    ),
                                ).toEqual([
                                    {
                                        listId,
                                        pageUrl: 'bla.com',
                                        fullUrl: 'http://www.bla.com/',
                                        createdAt: expect.any(Date),
                                    },
                                    {
                                        listId,
                                        pageUrl: 'test.com',
                                        fullUrl: 'http://www.test.com/',
                                        createdAt: expect.any(Date),
                                    },
                                ])
                            },
                            execute: async ({ setup }) => {
                                await customLists(setup).removePageFromList({
                                    id: listId,
                                    url: 'test.com',
                                })
                            },
                            postCheck: async ({ setup }) => {
                                expect(
                                    await customLists(setup).fetchListPagesById(
                                        {
                                            id: listId,
                                        },
                                    ),
                                ).toEqual([
                                    {
                                        listId,
                                        pageUrl: 'bla.com',
                                        fullUrl: 'http://www.bla.com/',
                                        createdAt: expect.any(Date),
                                    },
                                ])
                            },
                        },
                    ],
                }
            },
        ),
    ],
)
