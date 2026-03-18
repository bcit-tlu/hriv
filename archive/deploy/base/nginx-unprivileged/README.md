# nginx-unprivileged

Adapted from [Run nginx as unprivileged user in Docker container on Kubernetes](https://harsimran-kaur.medium.com/run-nginx-as-unprivileged-user-in-docker-container-on-kubernetes-6e71564cf78b).

1. Set your cluster context

    `kubectl config set-context ...`

1. Apply the kustomized resources

    `kubectl kustomize | kpt live apply -`

1. (Optional) Validate resources by running the kpt `kubeval` function (requires Docker daemon to be running)

    `kpt fn render overlays/dev`
