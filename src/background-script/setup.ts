import { browser, Browser } from 'webextension-polyfill-ts'
import StorageManager from '@worldbrain/storex'
import NotificationBackground from 'src/notifications/background'
import SocialBackground from 'src/social-integration/background'
import DirectLinkingBackground from 'src/direct-linking/background'
import ActivityLoggerBackground, {
    TabManager,
} from 'src/activity-logger/background'
import SearchBackground from 'src/search/background'
import EventLogBackground from 'src/analytics/internal/background'
import CustomListBackground from 'src/custom-lists/background'
import TagsBackground from 'src/tags/background'
import BookmarksBackground from 'src/bookmarks/background'
import * as backup from '../backup/background'
import * as backupStorage from '../backup/background/storage'
import {
    registerModuleMapCollections,
    StorageModule,
} from '@worldbrain/storex-pattern-modules'
import { setupBlacklistRemoteFunctions } from 'src/blacklist/background'
import {
    setImportStateManager,
    ImportStateManager,
} from 'src/imports/background/state-manager'
import { setupImportBackgroundModule } from 'src/imports/background'
import { AuthService } from 'src/authentication/background/auth-service'
import { AuthFirebase } from 'src/authentication/background/auth-firebase'
import {
    FirebaseFunctionsAuth,
    FirebaseFunctionsSubscription,
} from 'src/authentication/background/firebase-functions-subscription'
import {
    AuthBackground,
    AuthInterface,
    AuthServerFunctionsInterface,
    SubscriptionServerFunctionsInterface,
} from 'src/authentication/background/types'

export interface BackgroundModules {
    notifications: NotificationBackground
    social: SocialBackground
    activityLogger: ActivityLoggerBackground
    directLinking: DirectLinkingBackground
    search: SearchBackground
    eventLog: EventLogBackground
    customLists: CustomListBackground
    tags: TagsBackground
    bookmarks: BookmarksBackground
    backupModule: backup.BackupBackgroundModule
    auth: AuthBackground
}

export function createBackgroundModules(options: {
    storageManager: StorageManager
    browserAPIs: Browser
    tabManager?: TabManager
    authImplementation?: AuthInterface
    authServerSubscriptionFunctions?: SubscriptionServerFunctionsInterface
    authServerAuthFunctions?: AuthServerFunctionsInterface
}): BackgroundModules {
    const { storageManager } = options
    const tabManager = options.tabManager || new TabManager()

    const search = new SearchBackground({
        storageManager,
        tabMan: tabManager,
        browserAPIs: options.browserAPIs,
    })

    const notifications = new NotificationBackground({ storageManager })
    const social = new SocialBackground({ storageManager })
    const activityLogger = new ActivityLoggerBackground({
        searchIndex: search.searchIndex,
        browserAPIs: options.browserAPIs,
        tabManager,
    })

    const authService = new AuthService(
        options.authImplementation || new AuthFirebase(),
    )
    const subscriptionServerFunctions =
        options.authServerSubscriptionFunctions ||
        new FirebaseFunctionsSubscription()
    const authServerFunctions =
        options.authServerAuthFunctions || new FirebaseFunctionsAuth()

    return {
        auth: {
            authService,
            subscriptionServerFunctions,
            authServerFunctions,
        },
        notifications,
        social,
        activityLogger,
        directLinking: new DirectLinkingBackground({
            browserAPIs: options.browserAPIs,
            storageManager,
            socialBg: social,
            searchIndex: search.searchIndex,
        }),
        search,
        eventLog: new EventLogBackground({ storageManager }),
        customLists: new CustomListBackground({
            storageManager,
            tabMan: activityLogger.tabManager,
            windows: browser.windows,
            searchIndex: search.searchIndex,
        }),
        tags: new TagsBackground({
            storageManager,
            searchIndex: search.searchIndex,
            tabMan: activityLogger.tabManager,
            windows: browser.windows,
        }),
        bookmarks: new BookmarksBackground({ storageManager }),
        backupModule: new backup.BackupBackgroundModule({
            storageManager,
            searchIndex: search.searchIndex,
            lastBackupStorage: new backupStorage.LocalLastBackupStorage({
                key: 'lastBackup',
            }),
            notifications,
        }),
    }
}

export function setupBackgroundModules(backgroundModules: BackgroundModules) {
    setImportStateManager(
        new ImportStateManager({
            searchIndex: backgroundModules.search.searchIndex,
        }),
    )
    setupImportBackgroundModule({
        searchIndex: backgroundModules.search.searchIndex,
        tagsModule: backgroundModules.tags,
        customListsModule: backgroundModules.customLists,
    })
    backgroundModules.notifications.setupRemoteFunctions()
    backgroundModules.social.setupRemoteFunctions()
    backgroundModules.directLinking.setupRemoteFunctions()
    backgroundModules.directLinking.setupRequestInterceptor()
    backgroundModules.activityLogger.setupRemoteFunctions()
    backgroundModules.activityLogger.setupWebExtAPIHandlers()
    backgroundModules.search.setupRemoteFunctions()
    backgroundModules.eventLog.setupRemoteFunctions()
    backgroundModules.customLists.setupRemoteFunctions()
    backgroundModules.tags.setupRemoteFunctions()
    backgroundModules.backupModule.setBackendFromStorage()
    backgroundModules.backupModule.setupRemoteFunctions()
    backgroundModules.backupModule.startRecordingChangesIfNeeded()
    setupBlacklistRemoteFunctions()
}

export function getBackgroundStorageModules(
    backgroundModules: BackgroundModules,
): { [moduleName: string]: StorageModule } {
    return {
        annotations: backgroundModules.directLinking.annotationStorage,
        notifications: backgroundModules.notifications.storage,
        customList: backgroundModules.customLists.storage,
        bookmarks: backgroundModules.bookmarks.storage,
        backup: backgroundModules.backupModule.storage,
        eventLog: backgroundModules.eventLog.storage,
        search: backgroundModules.search.storage,
        social: backgroundModules.social.storage,
        tags: backgroundModules.tags.storage,
    }
}

export function registerBackgroundModuleCollections(
    storageManager: StorageManager,
    backgroundModules: BackgroundModules,
) {
    registerModuleMapCollections(
        storageManager.registry,
        getBackgroundStorageModules(backgroundModules),
    )
}
