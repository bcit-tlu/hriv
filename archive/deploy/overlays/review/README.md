# Review Overlay Notes

## Local cluster `review` overlay development

1. Install Drone's `envsubst`

    go install github.com/drone/envsubst/cmd/envsubst

1. Export variables

    export GIT_TAG=0.0.1
    && export IMAGE_TAG=latest
    && export IMAGE_NAME=registry.ltc.bcit.ca/web-apps/corgi/corgi
    && export INGRESS_URL=corgi
    && export DEPLOY_NAMESPACE=corgi

1. In `kustomization.yaml`, uncomment the `secretGenerator` and patch sections to enable your local cluster to pull from the project's private registry.

1. Generate `secrets/tls.crt` and `secrets/tls.key` with fake values (the ingress needs *something* or it complains)

1. Generate a `secrets/.dockerconfigjson`:

  {"auths":{"registry.ltc.bcit.ca":{"username":"{yourGitLabUsername}","password":"{yourGitLabPersonalAccessToken}","auth":"{someBase64HashSeeBelow}"}}}

  # where `authValue` = $(printf "${yourGitLabUsername}:${yourGitLabPersonalAccessToken}" | base64)
  # (no curly brackets)

1. Hydrate `review` overlay resources with `envsubst`, and then apply them to the local cluster

    kustomize build ./apps/ | $GOPATH/bin/envsubst | kubectl apply -f -

