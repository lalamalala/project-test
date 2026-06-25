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
            // Archive JSON metrics + JUnit XML + HTML reports for all test types
            archiveArtifacts(
                artifacts:         'k6-report-*.json, k6-report-*.html, k6-junit-*.xml',
                allowEmptyArchive: true
            )
            // Publish JUnit-style test results – glob picks up smoke + load XMLs
            junit(
                testResults:       'k6-junit-*.xml',
                allowEmptyResults: true
            )
            // Response-time & pass-rate trend charts across builds.
            // Requires: Performance Plugin
            //   Jenkins → Manage Jenkins → Plugins → search "Performance" → Install
            perfReport(
                sourceDataFiles:            'k6-junit-*.xml',
                errorUnstableThreshold:     0,
                errorFailedThreshold:       5,
                modePerformancePerTestCase: true
            )
            // Publish HTML reports (smoke and/or load) in Jenkins UI
            // Requires: HTML Publisher Plugin
            publishHTML(target: [
                allowMissing:          true,
                alwaysLinkToLastBuild: true,
                keepAll:               true,
                reportDir:             '.',
                reportFiles:           'k6-report-smoke.html,k6-report-load.html',
                reportName:            'k6 Test Reports',
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
