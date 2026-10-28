class Lehrosol < Formula
  desc "Unified agentic engineering console"
  homepage "https://github.com/lehrosolutions/lehrosol-cli"
  url "https://registry.npmjs.org/@lehrosolutions/cli/-/cli-3.2.0-beta.2.tgz"
  version "3.2.0-beta.2"
  sha256 "c8efdc6cb0432f3c04b45f103e41f7b023b5e9730885f443e85c40f3b366ab50"
  license "Apache-2.0"
  depends_on "node@20"
  def install
    libexec.install Dir["*"]
    bin.install_symlink libexec/"bin/lehrosol.js" => "lehrosol"
  end
  test do
    assert_match version.to_s, shell_output("#{bin}/lehrosol --version")
  end
end
