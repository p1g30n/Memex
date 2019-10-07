import 'babel-polyfill'
import 'core-js/es7/symbol'
import { browser } from 'webextension-polyfill-ts'

import initStorex from './search/memex-storex'
import getDb, { setStorex } from './search/get-db'
import internalAnalytics from './analytics/internal'
import initSentry from './util/raven'
import {
    makeRemotelyCallableType,
    setupRemoteFunctionsImplementations,
} from 'src/util/webextensionRPC'
import { StorageChangesManager } from 'src/util/storage-changes'

// Features that require manual instantiation to setup
import BackgroundScript from './background-script'
import alarms from './background-script/alarms'
import createNotification, {
    setupNotificationClickListener,
} from 'src/util/notifications'

// Features that auto-setup
import './analytics/background'
import './imports/background'
import './omnibar'
import analytics from './analytics'
import {
    createBackgroundModules,
    setupBackgroundModules,
    registerBackgroundModuleCollections,
} from './background-script/setup'
import { AuthService } from 'src/authentication/background/auth-service'
import { firebase } from 'src/util/firebase-app-initialized'
import { AuthFirebase } from 'src/authentication/background/auth-firebase'
import {
    FirebaseFunctionsAuth,
    FirebaseFunctionsSubscription,
} from 'src/authentication/background/firebase-functions-subscription'

if (
    process.env.NODE_ENV !== 'production'
    // && process.env.LOCAL_AUTH_SERVICE === 'true'
) {
    firebase.functions().useFunctionsEmulator('http://localhost:5001')
}
const storageManager = initStorex()
const localStorageChangesManager = new StorageChangesManager({
    storage: browser.storage,
})

initSentry({ storageChangesManager: localStorageChangesManager })
const backgroundModules = createBackgroundModules({
    storageManager,
    browserAPIs: browser,
})

// TODO: There's still some evil code around that imports this entry point
const { tags, customLists: customList } = backgroundModules
export { tags, customList }

setupBackgroundModules(backgroundModules)
registerBackgroundModuleCollections(storageManager, backgroundModules)
setupNotificationClickListener()

let bgScript: BackgroundScript

storageManager.finishInitialization().then(() => {
    setStorex(storageManager)

    // TODO: This stuff should live in src/background-script/setup.ts
    internalAnalytics.registerOperations(backgroundModules.eventLog)
    backgroundModules.backupModule.storage.setupChangeTracking()

    bgScript = new BackgroundScript({
        storageManager,
        notifsBackground: backgroundModules.notifications,
        loggerBackground: backgroundModules.activityLogger,
        storageChangesMan: localStorageChangesManager,
    })
    bgScript.setupRemoteFunctions()
    bgScript.setupWebExtAPIHandlers()
    bgScript.setupAlarms(alarms)
})

// Gradually moving all remote function registrations here
setupRemoteFunctionsImplementations({
    auth: {
        getUser: backgroundModules.auth.authService.getUser,
        refresh: backgroundModules.auth.authService.refresh,
        hasValidPlan: backgroundModules.auth.authService.hasValidPlan,
        hasSubscribedBefore:
            backgroundModules.auth.authService.hasSubscribedBefore,
    },
    serverFunctions: {
        getCheckoutLink:
            backgroundModules.auth.subscriptionServerFunctions.getCheckoutLink,
        getManageLink:
            backgroundModules.auth.subscriptionServerFunctions.getManageLink,
        refreshUserClaims:
            backgroundModules.auth.authServerFunctions.refreshUserClaims,
    },
    notifications: { createNotification },
    bookmarks: {
        addPageBookmark:
            backgroundModules.search.remoteFunctions.bookmarks.addPageBookmark,
        delPageBookmark:
            backgroundModules.search.remoteFunctions.bookmarks.delPageBookmark,
    },
})

// Attach interesting features onto global window scope for interested users
// TODO: Shouldn't we prefix these with memex_ to avoid collisions?
window['authService'] = backgroundModules.auth.authService
window['authServerFunctions'] = backgroundModules.auth.authServerFunctions
window['getDb'] = getDb
window['storageMan'] = storageManager
window['bgScript'] = bgScript
window['bgModules'] = backgroundModules
window['analytics'] = analytics
window['tabMan'] = backgroundModules.activityLogger.tabManager
