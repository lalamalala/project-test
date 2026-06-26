// Jenkinsfile – Declarative Pipeline for k6 QuickPizza load test
// Windows-compatible: uses `bat` steps and ^ line-continuation
// ─────────────────────────────────────────────────────────────────────────────
// Requirements on the Jenkins agent:
//   • k6 installed and available on PATH
//   • Jenkins Credential (Secret Text) with ID "k6-cloud-token"
//     Jenkins → Manage Jenkins → Credentials → Global → Add Credential
//       Kind   : Secret text
//       Secret : <Grafana Cloud k6 API token>
//       ID     : k6-cloud-token
// ─────────────────────────────────────────────────────────────────────────────

pipeline {

    // ── Agent ─────────────────────────────────────────────────────────────────
    // Option A: k6 installed directly on the Windows agent (default)
    agent any

    // Option B: official k6 Docker image – Linux container, requires Docker on agent
    // agent {
    //     docker {
    //         image 'grafana/k6:latest'
    //         args  '--entrypoint="" -u root'
    //     }
    // }

    // ── Build parameters (visible in "Build with Parameters" UI) ─────────────
    parameters {
        choice(
            name:        'TEST_TYPE',
            choices:     ['smoke', 'load', 'smoke+load'],
            description: 'smoke – sanity check only (default) | load – load test only | smoke+load – smoke first, then load'
        )

        // ── Smoke profile ────────────────────────────────────────────────────
        string(
            name:         'SMOKE_VUS',
            defaultValue: '1',
            description:  'Smoke – virtual users'
        )
        string(
            name:         'SMOKE_STEADY_TIME',
            defaultValue: '30s',
            description:  'Smoke – steady-state duration (e.g. 30s, 1m). Ramp-up/down fixed at 10s.'
        )

        // ── Load profile ─────────────────────────────────────────────────────
        string(
            name:         'LOAD_VUS',
            defaultValue: '5',
            description:  'Load – virtual users'
        )
        string(
            name:         'LOAD_RAMP_TIME',
            defaultValue: '30s',
            description:  'Load – ramp-up duration (e.g. 30s, 1m)'
        )
        string(
            name:         'LOAD_STEADY_TIME',
            defaultValue: '1m',
            description:  'Load – steady-state duration (e.g. 1m, 5m). Ramp-down fixed at 10s.'
        )

        // ── Common ───────────────────────────────────────────────────────────
        string(
            name:         'BASE_URL',
            defaultValue: 'https://quickpizza.grafana.com',
            description:  'Target server URL (no trailing slash)'
        )
        booleanParam(
            name:         'RUN_LIGHTHOUSE',
            defaultValue: true,
            description:  'Run Lighthouse page audit before load tests (requires Node.js + Chrome on agent)'
        )
        string(
            name:         'LIGHTHOUSE_THRESHOLD',
            defaultValue: '70',
            description:  'Minimum acceptable Lighthouse score (0-100). Scores below this are flagged in the HTML report.'
        )
        // ── Lighthouse authenticated audit ───────────────────────────────────
        // Requires Jenkins credential: ID = quickpizza-admin-password, Kind = Secret text
        // Jenkins → Manage Jenkins → Credentials → Global → Add Credential
        //   Kind   : Secret text
        //   Secret : <QuickPizza admin password>
        //   ID     : quickpizza-admin-password
        string(
            name:         'ADMIN_USER',
            defaultValue: 'admin',
            description:  'QuickPizza admin username for authenticated Lighthouse audit'
        )
        booleanParam(
            name:         'ABORT_ON_THRESHOLD',
            defaultValue: true,
            description:  'Fail the build when k6 thresholds are breached (exit code 99)'
        )
        booleanParam(
            name:         'SEND_TO_CLOUD',
            defaultValue: true,
            description:  'Stream results to Grafana Cloud k6 (requires k6-cloud-token credential)'
        )
    }

    // ── Pipeline-wide environment ─────────────────────────────────────────────
    environment {
        K6_NO_USAGE_REPORT  = 'true'

        // Grafana Cloud k6 – injected from Jenkins Credentials Store
        // k6 reads K6_CLOUD_TOKEN automatically when --out cloud is used
        K6_CLOUD_TOKEN      = credentials('k6-cloud-token')
        K6_CLOUD_PROJECT_ID = '7896259'
    }

    // ── Stages ────────────────────────────────────────────────────────────────
    stages {

        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Validate k6 installation') {
            steps {
                bat 'k6 version'
            }
        }

        // ── Lighthouse page performance audit ─────────────────────────────────
        // Audits each page BEFORE load tests to capture a clean-state baseline.
        // Scores are saved as JUnit XML → Jenkins Performance Plugin shows
        // score trends (Performance, Accessibility, Best Practices, SEO) across builds.
        //
        // Requirements on the Jenkins agent:
        //   • Node.js + npm  (verified via `node --version`)
        //   • Lighthouse CLI  (npm install -g lighthouse)
        //   • Google Chrome   (must be discoverable by Lighthouse)
        stage('Lighthouse audit') {
            when {
                expression { params.RUN_LIGHTHOUSE }
            }
            steps {
                script {
                    bat 'node --version'
                    bat 'if not exist chrome-temp mkdir chrome-temp'

                    def pages = [
                        [name: 'main',        url: "${params.BASE_URL}/"],
                        [name: 'admin-login', url: "${params.BASE_URL}/admin"],
                    ]

                    pages.each { page ->
                        echo "Auditing ${page.url} ..."
                        withEnv([
                            "TEMP=${env.WORKSPACE}\\chrome-temp",
                            "TMP=${env.WORKSPACE}\\chrome-temp",
                        ]) {
                            // Capture exit code: on Windows, Lighthouse often exits 1 due to
                            // EPERM when chrome-launcher tries to rmSync its own temp dir
                            // (chrome-launcher bug on Windows service accounts).
                            // The HTML/JSON reports are written BEFORE cleanup, so exit code 1
                            // is safe to ignore as long as the report file was actually created.
                            def lhExit = bat(returnStatus: true, script:
                                "npx --yes lighthouse ${page.url}" +
                                " --output html --output json" +
                                " --output-path lh-${page.name}" +
                                " --chrome-flags=\"--headless --no-sandbox --disable-gpu --user-data-dir=chrome-tmp\"" +
                                " --quiet"
                            )
                            if (lhExit != 0) {
                                def missing = bat(returnStatus: true,
                                    script: "if not exist lh-${page.name}.report.json exit 1")
                                if (missing != 0) {
                                    error "Lighthouse failed for ${page.url}: report not generated (exit ${lhExit})"
                                }
                                echo "WARNING: Lighthouse exited ${lhExit} (EPERM on temp cleanup – known Windows issue). Report generated OK."
                            }
                        }
                    }

                    // Convert Lighthouse JSON → JUnit XML for Jenkins trend charts
                    bat "node scripts/lighthouse-to-junit.js ${params.LIGHTHOUSE_THRESHOLD}"

                    // ── Authenticated admin page audit ─────────────────────
                    // Requires 'quickpizza-admin-password' Jenkins credential.
                    // If the credential is not found the step is skipped gracefully.
                    try {
                        withCredentials([string(
                            credentialsId: 'quickpizza-admin-password',
                            variable:      'QP_ADMIN_PASS'
                        )]) {
                            echo "Getting QuickPizza auth token for admin page audit ..."
                            bat "node scripts/get-auth-headers.js ${params.BASE_URL} ${params.ADMIN_USER} %QP_ADMIN_PASS% lh-auth-headers.json"

                            withEnv([
                                "TEMP=${env.WORKSPACE}\\chrome-temp",
                                "TMP=${env.WORKSPACE}\\chrome-temp",
                            ]) {
                                def adminExit = bat(returnStatus: true, script:
                                    "npx --yes lighthouse ${params.BASE_URL}/admin" +
                                    " --output html --output json" +
                                    " --output-path lh-admin" +
                                    " --extra-headers-path lh-auth-headers.json" +
                                    " --chrome-flags=\"--headless --no-sandbox --disable-gpu --user-data-dir=chrome-tmp\"" +
                                    " --quiet"
                                )
                                if (adminExit != 0) {
                                    def missing = bat(returnStatus: true,
                                        script: 'if not exist lh-admin.report.json exit 1')
                                    if (missing != 0) {
                                        echo "WARNING: Authenticated admin audit failed (exit ${adminExit}) – report not generated, skipping."
                                    } else {
                                        echo "WARNING: Lighthouse exited ${adminExit} (EPERM on temp cleanup). Report generated OK."
                                    }
                                }
                            }
                            // Re-run the converter to include the new lh-admin.report.json
                            bat "node scripts/lighthouse-to-junit.js ${params.LIGHTHOUSE_THRESHOLD}"
                        }
                    } catch (e) {
                        echo "INFO: Skipping authenticated admin page audit (quickpizza-admin-password credential not found)."
                    }
                }
            }
        }

        stage('Smoke test') {
            when {
                expression { params.TEST_TYPE == 'smoke' || params.TEST_TYPE == 'smoke+load' }
            }
            steps {
                script {
                    def reportJson = "k6-report-smoke-${env.BUILD_NUMBER}.json"
                    def cmdParts = [
                        'k6 run',
                        "--out json=${reportJson}",
                    ]
                    if (params.SEND_TO_CLOUD) { cmdParts << '--out cloud' }
                    cmdParts.addAll([
                        "-e BASE_URL=${params.BASE_URL}",
                        '-e TEST_TYPE=smoke',
                        "-e SMOKE_VUS=${params.SMOKE_VUS}",
                        "-e SMOKE_STEADY_TIME=${params.SMOKE_STEADY_TIME}",
                        'tests\\quickpizza.js',
                    ])
                    def exitCode = bat(returnStatus: true, script: cmdParts.join(' ^\n        '))
                    if (exitCode == 99 && !params.ABORT_ON_THRESHOLD) {
                        echo 'WARNING: smoke thresholds breached but ABORT_ON_THRESHOLD=false – continuing.'
                    } else if (exitCode != 0) {
                        error "Smoke test failed with exit code ${exitCode}"
                    }
                }
            }
        }

        stage('Load test') {
            when {
                expression { params.TEST_TYPE == 'load' || params.TEST_TYPE == 'smoke+load' }
            }
            steps {
                script {
                    def reportJson = "k6-report-load-${env.BUILD_NUMBER}.json"
                    def cmdParts = [
                        'k6 run',
                        "--out json=${reportJson}",
                    ]
                    if (params.SEND_TO_CLOUD) { cmdParts << '--out cloud' }
                    cmdParts.addAll([
                        "-e BASE_URL=${params.BASE_URL}",
                        '-e TEST_TYPE=load',
                        "-e LOAD_VUS=${params.LOAD_VUS}",
                        "-e LOAD_RAMP_TIME=${params.LOAD_RAMP_TIME}",
                        "-e LOAD_STEADY_TIME=${params.LOAD_STEADY_TIME}",
                        'tests\\quickpizza.js',
                    ])
                    def exitCode = bat(returnStatus: true, script: cmdParts.join(' ^\n        '))
                    if (exitCode == 99 && !params.ABORT_ON_THRESHOLD) {
                        echo 'WARNING: load thresholds breached but ABORT_ON_THRESHOLD=false – continuing.'
                    } else if (exitCode != 0) {
                        error "Load test failed with exit code ${exitCode}"
                    }
                }
            }
        }
    }

    // ── Post-build actions ────────────────────────────────────────────────────
    post {
        always {
            // ── Archive everything ──────────────────────────────────────────
            // lh-*.report.html require JS and cannot render inside Jenkins CSP –
            // kept as downloadable artifacts only.
            // lighthouse-report/ contains summary.html + lh-style.css (CSS in a
            // separate file so Jenkins style-src 'self' CSP allows it).
            archiveArtifacts(
                artifacts:         'k6-report-*.json, k6-report-*.html, k6-junit-*.xml, lh-*.report.html, lh-*.report.json, lighthouse-junit.xml, lighthouse-report/**, lighthouse-scores-prev.json',
                allowEmptyArchive: true
            )

            // ── JUnit trend (k6 checks + Lighthouse scores) ────────────────
            junit(
                testResults:       'k6-junit-*.xml, lighthouse-junit.xml',
                allowEmptyResults: true
            )

            // ── Performance Plugin removed ───────────────────────────
            // perfReport removed: it adds a trend widget to the project main page
            // that clutters the Status view. Trend data is tracked via junit step above.

            // ── k6 HTML reports ────────────────────────────────────────────
            // Requires: HTML Publisher Plugin
            publishHTML(target: [
                allowMissing:          true,
                alwaysLinkToLastBuild: true,
                keepAll:               true,
                reportDir:             '.',
                reportFiles:           'k6-report-smoke.html,k6-report-load.html',
                reportName:            'k6 Test Reports',
            ])

            // ── Lighthouse summary ─────────────────────────────────────────
            // reportDir points to the subdirectory so that lh-style.css is served
            // from the same origin as summary.html (satisfies style-src 'self' CSP).
            // Requires: HTML Publisher Plugin
            publishHTML(target: [
                allowMissing:          true,
                alwaysLinkToLastBuild: true,
                keepAll:               true,
                reportDir:             'lighthouse-report',
                reportFiles:           'summary.html',
                reportName:            'Lighthouse Audit Reports',
            ])
        }

        success {
            echo 'k6 test(s) PASSED – all thresholds met.'
        }

        failure {
            echo 'k6 test(s) FAILED – check Console Output and the archived reports.'
        }
    }
}
