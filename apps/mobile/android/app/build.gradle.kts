import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// ---------------------------------------------------------------------------
// Release signing (aucune cle dans le depot).
// Sources, par ordre de priorite :
//   1. variables d'environnement (CI) : ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD,
//      ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD ;
//   2. android/key.properties (hors depot, ignore par git) : storeFile, storePassword,
//      keyAlias, keyPassword. storeFile est relatif a android/ ou absolu.
// Sans keystore complet, toute tache *Release* (assemble, bundle, package...) ECHOUE :
// un APK release signe en debug ne pourrait pas etre mis a jour par la vraie release,
// et la desinstallation forcee detruirait la file de saisies non synchronisees.
// Essais locaux seulement : RECALLFARM_ALLOW_DEBUG_SIGNED_RELEASE=true signe la
// release avec la cle de DEBUG (avertissement). Les builds debug ne sont jamais
// concernes. Voir apps/mobile/README.md § 9 « Signature release ».
// ---------------------------------------------------------------------------
val keystoreProperties = Properties().apply {
    val f = rootProject.file("key.properties")
    if (f.exists()) FileInputStream(f).use { load(it) }
}

fun signingValue(env: String, prop: String): String? =
    System.getenv(env)?.takeIf { it.isNotBlank() }
        ?: keystoreProperties.getProperty(prop)?.takeIf { it.isNotBlank() }

val releaseStorePath: String? = signingValue("ANDROID_KEYSTORE_PATH", "storeFile")
val releaseStoreFile: File? = releaseStorePath?.let { path ->
    val asIs = File(path)
    if (asIs.isAbsolute) asIs else rootProject.file(path)
}
val releaseStorePassword: String? = signingValue("ANDROID_KEYSTORE_PASSWORD", "storePassword")
val releaseKeyAlias: String? = signingValue("ANDROID_KEY_ALIAS", "keyAlias")
val releaseKeyPassword: String? = signingValue("ANDROID_KEY_PASSWORD", "keyPassword") ?: releaseStorePassword
val hasReleaseSigning: Boolean = releaseStoreFile != null && releaseStoreFile.exists() &&
    releaseStorePassword != null && releaseKeyAlias != null && releaseKeyPassword != null
val allowDebugSignedRelease: Boolean = System.getenv("RECALLFARM_ALLOW_DEBUG_SIGNED_RELEASE") == "true"

if (hasReleaseSigning) {
    logger.lifecycle("RecallFarm : release signee avec le keystore ${releaseStoreFile?.name} (alias $releaseKeyAlias).")
} else {
    val reason = when {
        releaseStorePath == null -> "aucun keystore configure (ANDROID_KEYSTORE_PATH ou android/key.properties)"
        releaseStoreFile?.exists() != true -> "keystore introuvable : $releaseStoreFile"
        else -> "mot de passe ou alias manquant"
    }
    // Checked once the task graph is known, so that debug builds are never blocked.
    gradle.taskGraph.whenReady {
        val releaseTasks = allTasks.filter { it.project.name == "app" && it.name.contains("Release") }
        if (releaseTasks.isNotEmpty()) {
            if (!allowDebugSignedRelease) {
                throw GradleException(
                    "RecallFarm : release refusee, $reason. Fournir la cle (README § 9) ou, pour un essai " +
                        "local uniquement, RECALLFARM_ALLOW_DEBUG_SIGNED_RELEASE=true."
                )
            }
            logger.warn(
                "WARNING: RecallFarm : release signee avec la cle de DEBUG ($reason, " +
                    "RECALLFARM_ALLOW_DEBUG_SIGNED_RELEASE=true). APK d'essai, a ne jamais distribuer."
            )
        }
    }
}

// minSdk : celui de Flutter 3.38, soit 24 (Android 7). Android 6 (API 23, cible initiale)
// ne compile plus : url_launcher_android 6.3.30 declare minSdk 24 et Flutter annonce
// l'abandon de l'API 23. Voir docs/plan/questions.md Q-MOB-01.

android {
    namespace = "app.recallfarm.recallfarm"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "app.recallfarm.recallfarm"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    // Bibliotheques natives compressees dans l'APK (ADR-003) : telechargement plus leger
    // en 2G, au prix d'une extraction a l'installation.
    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = releaseStoreFile
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
                enableV2Signing = true
            }
        }
    }

    buildTypes {
        release {
            // Debug key only reachable with the explicit opt-in (checked above).
            signingConfig = if (hasReleaseSigning) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

flutter {
    source = "../.."
}
