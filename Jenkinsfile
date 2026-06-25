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
        string(
            name:         'BASE_URL',
            defaultValue: 'https://quickpizza.grafana.com',
            description:  'Target server URL (no trailing slash)'
        )
        string(
            name:         'BASE_VUS',
            defaultValue: '5',
            description:  'VUs for the warm-up / base-load stage'
        )
        string(
            name:         'PEAK_VUS',
            defaultValue: '20',
            description:  'VUs at peak load'
        )
        string(
            name:         'RAMP_TIME',
            defaultValue: '30s',
            description:  'Duration of each ramp stage (e.g. 30s, 1m)'
        )
        string(
            name:         'STEADY_TIME',
            defaultValue: '2m',
            description:  'Duration of each steady-state stage (e.g. 2m, 5m)'
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
        K6_REPORT           = "k6-report-${env.BUILD_NUMBER}.json"
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

        stage('Run k6 load test') {
            steps {
                script {
                    // Build k6 command parts – append --out cloud only when requested
                    def cmdParts = [
                        'k6 run',
                        "--out json=${K6_REPORT}",
                    ]

                    if (params.SEND_TO_CLOUD) {
                        cmdParts << '--out cloud'
                    }

                    cmdParts.addAll([
                        "-e BASE_URL=${params.BASE_URL}",
                        "-e BASE_VUS=${params.BASE_VUS}",
                        "-e PEAK_VUS=${params.PEAK_VUS}",
                        "-e RAMP_TIME=${params.RAMP_TIME}",
                        "-e STEADY_TIME=${params.STEADY_TIME}",
                        'tests\\quickpizza.js',
                    ])

                    // Join with Windows ^ line-continuation for readable console output
                    def k6cmd = cmdParts.join(' ^\n        ')

                    def exitCode = bat(returnStatus: true, script: k6cmd)

                    // exit 99 = thresholds breached; exit 0 = success; anything else = real error
                    if (exitCode == 99 && !params.ABORT_ON_THRESHOLD) {
                        echo 'WARNING: k6 thresholds were breached but ABORT_ON_THRESHOLD=false – continuing.'
                    } else if (exitCode != 0) {
                        error "k6 run failed with exit code ${exitCode}"
                    }
                }
            }
        }
    }

    // ── Post-build actions ────────────────────────────────────────────────────
    post {
        always {
            // Archive raw JSON metrics
            archiveArtifacts(
                artifacts:         "${K6_REPORT}, k6-report.html",
                allowEmptyArchive: true
            )
            perfReport (
                sourceDataFiles: "${K6_REPORT}", errorUnstableThreshold: 0 
                )
            // Publish HTML report in Jenkins UI
            // Requires: HTML Publisher Plugin
            //   Jenkins → Manage Jenkins → Plugins → search "HTML Publisher" → Install
            publishHTML(target: [
                allowMissing:          true,
                alwaysLinkToLastBuild: true,
                keepAll:               true,
                reportDir:             '.',
                reportFiles:           'k6-report.html',
                reportName:            'k6 Load Test Report',
            ])
        }

        success {
            echo 'k6 load test PASSED – all thresholds met.'
        }

        failure {
            echo 'k6 load test FAILED – check Console Output and the archived JSON report.'
        }
    }
}
