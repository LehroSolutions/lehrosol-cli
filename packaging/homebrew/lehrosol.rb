class Lehrosol < Formula
  desc "Unified agentic engineering console"
  homepage "https://github.com/lehrosolutions/lehrosol-cli"
  url "https://example.com/lehrosol-cli-3.2.0.tgz"
  version "3.2.0"
  sha256 "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
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
