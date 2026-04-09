{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    kubectl
    kubernetes-helm
    fluxcd
    kubectx
    kustomize
    krew
    git
    jq
    poetry
    nixd
  ];
}
