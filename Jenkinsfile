pipeline {
    agent any

    stages {
        stage('Setup Environment') {
            steps {
                withCredentials([file(credentialsId: 'fashion-erp-env-global', variable: 'ENV_FILE')]) {
                    sh 'cp "$ENV_FILE" .env'
                }
            }
        }

        stage('Install Dependencies') {
            steps {
                sh 'node -v'
                sh 'npm -v'
                sh 'npm ci'
            }
        }

        stage('Prisma Generate') {
            steps {
                sh 'npx prisma generate'
            }
        }

        stage('Test') {
            steps {
                sh 'npm test'
            }
        }

        stage('Build') {
            steps {
                sh 'npm run build'
            }
        }
    }

    post {
        success {
            echo 'Fashion ERP build successful!'
        }

        failure {
            echo 'Fashion ERP build failed!'
        }

        always {
            sh 'rm -f .env'
        }
    }
}